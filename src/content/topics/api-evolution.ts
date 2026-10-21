import type { Topic } from '../../types';

const topic: Topic = {
  id: 'api-evolution',
  phase: 'apis-security',
  order: 2,
  title: 'API Versioning, Contracts & Testing',
  subtitle:
    'Evolving APIs without breaking consumers: semantic versioning, URI/header/media-type versioning, expand-contract, deprecation and Sunset, automated breaking-change detection, protobuf evolution, consumer-driven contracts with Pact, Testcontainers, and the strangler fig for monolith APIs.',
  estimatedMinutes: 90,
  sources: [
    'Mastering API Architecture — Ch 1 (API Versioning, OpenAPI and Versioning, Detecting Changes)',
    'Mastering API Architecture — Ch 2 Testing APIs (quadrant, pyramid, contract, component, integration, E2E)',
    'Mastering API Architecture — Ch 8 Evolving to APIs (strangler fig, facades)',
    'RFC 8594 Sunset header; RFC 9745 Deprecation header',
    'Protocol Buffers — Updating a Message Type; Buf breaking-change rules',
    'Pact documentation; Testcontainers for Node.js',
    'Ford, Parsons, Kua — Building Evolutionary Architectures (fitness functions)',
  ],
  tags: ['versioning', 'semver', 'backward-compatibility', 'expand-contract', 'deprecation', 'openapi-diff', 'protobuf', 'pact', 'contract-testing', 'testcontainers', 'strangler-fig'],
  cheatSheet: [
    'Backward compatible = old clients keep working with the new server; forward compatible = old servers/clients tolerate data from newer versions (ignore unknown fields).',
    'Safe changes: add optional request fields, add response fields, add endpoints, add enum values only if clients tolerate unknowns. Breaking: remove/rename fields, change types or formats, make optional → required, change status codes or error types, tighten validation.',
    'SemVer for APIs: MAJOR = breaking (consumer must act), MINOR = backward-compatible feature, PATCH = fix. Expose only MAJOR to consumers (/v1); ship MINOR/PATCH continuously.',
    'Versioning styles: URI (/v2 — explicit, cache-friendly, most common), header (Api-Version or Stripe-style dated versions pinned per account), media type (Accept: application/vnd.acme.v2+json — most "RESTful", least discoverable).',
    'Expand → migrate → contract: add the new shape alongside the old, move consumers (measure usage per client), then remove the old one. Never rename in one step.',
    'Deprecate loudly: Deprecation (RFC 9745) + Sunset (RFC 8594) headers + Link to migration docs, per-client usage metrics, brownouts before removal.',
    'Gate breaking changes in CI: openapi-diff/oasdiff for OpenAPI, buf breaking for protobuf, graphql-inspector for GraphQL schemas.',
    'Protobuf: field NUMBERS are the contract — never change or reuse them (use reserved), don\'t change types, add fields freely, enums need a 0 = UNSPECIFIED value; renames are wire-safe but break JSON mapping.',
    'Consumer-driven contracts (Pact): consumers record the interactions they rely on; providers verify them in CI; can-i-deploy blocks releases that would break a deployed consumer. Contracts ≠ schema conformance.',
    'Test pyramid for APIs: many unit, a solid middle of component/contract/integration (Testcontainers with real Postgres/Kafka), few E2E. Strangler fig + facade evolves a monolith API route by route behind a stable contract.',
  ],
  sections: [
    {
      heading: '1. What "breaking" means: compatibility vocabulary',
      body: `**Intuition:** an API is a promise. A breaking change is any change after which a client that did nothing wrong stops working. The client isn't recompiled with your library — it's running in production *right now* against your live service.

Mastering API Architecture frames the producer's three options when change is requested:
1. **Release a new version at a new location** — old consumers keep working; the owner now maintains (patches, secures) multiple versions.
2. **Release a backward-compatible version** — additive change, no consumer action; but even a "small bug fix" like correcting a misspelled field name breaks compatibility.
3. **Break compatibility** — all consumers must upgrade in lockstep; sometimes unavoidable, always expensive to coordinate.
Real platforms need all three, which is why rules about versioning and exposure are needed.

**Backward vs forward compatibility**
- **Backward compatible**: a *new* server works with *old* clients (the one that matters most for APIs).
- **Forward compatible**: an *old* reader tolerates data produced by a *newer* writer — e.g. an old client ignores unknown response fields, an old consumer skips unknown event fields. Achieved with the **tolerant reader** pattern: parse only what you need, ignore unknowns, don't fail on new enum values.

| Change | REST/JSON | Why |
|---|---|---|
| Add response field | Safe (if clients are tolerant) | Strict deserialisers (e.g. \`additionalProperties: false\` validation, some codegen) can still break |
| Add optional request field | Safe | Old clients don't send it; server defaults |
| Add required request field | **Breaking** | Old clients' requests now fail validation |
| Remove or rename field | **Breaking** | Clients read a missing value |
| Change type/format (\`"42"\` → \`42\`, cents → decimal) | **Breaking** | Parsing or semantics differ |
| Add enum value | **Potentially breaking** | Exhaustive switch statements in clients crash |
| Change status code / error type | **Breaking** | Client logic branches on them |
| Tighten validation (max length 255 → 100) | **Breaking** | Previously valid requests rejected |
| Change default sort / pagination semantics | **Breaking** (behavioural) | Same shape, different meaning |
| Loosen validation, add endpoint, add optional query param | Safe | — |

**Hyrum's Law:** with enough users, every observable behaviour (ordering, timing, error text) will be depended on by somebody. Contract tests make *which* behaviours are relied on explicit.`,
      keyPoints: [
        'Backward compatibility protects old clients; forward compatibility needs tolerant readers.',
        'Renames, type changes, new required inputs, stricter validation and new status codes are breaking.',
        'Behavioural changes (sorting, defaults) break clients even when the schema is unchanged.',
      ],
      source: 'Mastering API Architecture — Ch 1 (API Versioning)',
    },
    {
      heading: '2. Semantic versioning for APIs',
      body: `**Intuition:** a version number is a message to the consumer about how much work an upgrade will cost them.

The book applies **SemVer** (\`MAJOR.MINOR.PATCH\`, e.g. 1.5.1) to APIs:
- **MAJOR** — non-compatible change. Upgrading is an **active decision by the consumer**, usually with a migration guide and tracking of who has moved.
- **MINOR** — backward-compatible change; consumers receive it **without making any change** on their side.
- **PATCH** — bug fixes to an existing MAJOR.MINOR, no new functionality.

**In practice for web APIs**
- Expose **only the major version** in the contract consumers bind to (\`/v1\`, \`Api-Version: 1\`). Minor and patch versions are deployed continuously and appear in the OpenAPI \`info.version\` (1.4.0) and the changelog.
- A new major is **a new product**: it has its own lifecycle (beta → GA → deprecated → sunset), SLAs, docs and support window (commonly 12–24 months overlap for public APIs).
- Keep majors rare. Each live major multiplies testing, security patching, docs and on-call surface. Many successful APIs have had one or two majors in a decade by leaning on additive change.
- **Libraries vs services:** a library's consumers pin a version at compile time; a service's consumers all hit the running version — so for services, backward compatibility of every deployment is the default obligation, and a MAJOR means running two versions side by side.

**Say this in interviews:** "I treat the major version as a contract with a support window, and I work hard to never need a new one: additive changes, tolerant readers, expand-contract, and automated breaking-change detection."`,
      keyPoints: [
        'MAJOR = consumer must act; MINOR/PATCH = no consumer action.',
        'Expose only the major; ship minors continuously with a changelog.',
        'Every live major multiplies maintenance — avoid them via additive evolution.',
      ],
      source: 'Mastering API Architecture — Ch 1 (Semantic Versioning)',
    },
    {
      heading: '3. Versioning strategies: URI, header, media type, dated versions',
      body: `**Intuition:** all strategies answer "how does the request say which contract it wants?" They differ in visibility, cacheability and routing convenience.

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| **URI path** | \`GET /v2/orders/1\` | Explicit, easy to route at gateways, trivially cacheable, visible in logs/docs; most common (Google, Twitter/X, many public APIs) | "Same resource, two URIs"; encourages big-bang versions of the whole API |
| **Custom header** | \`Api-Version: 2\` | Clean URIs; can version per request | Invisible in browser/links; caches must \`Vary: Api-Version\`; easy to forget |
| **Media type (content negotiation)** | \`Accept: application/vnd.acme.order.v2+json\` | Most aligned with HTTP; version per representation | Hard to discover/test; tooling support uneven; needs \`Vary: Accept\` |
| **Query parameter** | \`?api-version=2024-05-01\` (Azure style) | Easy to use and test | Pollutes cache keys and URLs; mixing with other params |
| **Dated versions pinned per account** (Stripe) | \`Stripe-Version: 2024-06-20\`; default = account's pinned version | Consumers upgrade at their own pace; producer ships breaking changes often, each as a small "version change" module | Requires a transformation layer and discipline; many versions to test |

**The Stripe model in more detail:** the core code implements only the *latest* behaviour. Each breaking change is written as a small, self-contained transformation that converts responses (and requests) between adjacent versions. A request pinned to an old version passes through the chain of transformations backwards. This keeps one codebase while supporting years of versions.

**Recommendation for most teams:** URI major version for coarse contracts (clear, gateway-friendly) + strictly additive minor evolution inside it. Consider dated header versions if you're a platform that must make frequent small breaking changes for thousands of integrators.

**Whatever you choose:** default to a pinned/explicit version (never "latest" silently), send \`Vary\` for header-based schemes, and return the version actually served in a response header.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: URI or header versioning with per-route versions',
          code: `import { Controller, Get, Param, Version, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Option A: /v1/orders, /v2/orders
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Option B (instead): header-based -> Api-Version: 2 (remember Vary: Api-Version for caches)
  // app.enableVersioning({ type: VersioningType.HEADER, header: 'Api-Version', defaultVersion: '1' });
  await app.listen(3000);
}
bootstrap();

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Version('1')
  @Get(':id')
  getV1(@Param('id') id: string) {
    return this.orders.get(id).then(toV1);      // { total: "19.99" } legacy string amount
  }

  @Version('2')
  @Get(':id')
  getV2(@Param('id') id: string) {
    return this.orders.get(id).then(toV2);      // { total: { amount: 1999, currency: "EUR" } }
  }
}
// One domain model; per-version mappers at the edge keep the core version-agnostic.`,
        },
      ],
      keyPoints: [
        'URI versioning is explicit and gateway/cache friendly; headers and media types keep URIs clean.',
        'Stripe-style dated versions + transformation chain allow frequent small breaking changes.',
        'Keep the domain core version-agnostic; map per version at the edge.',
      ],
    },
    {
      heading: '4. Expand–contract (parallel change)',
      body: `**Intuition:** you don't replace a bridge by demolishing it and building a new one — you build the new bridge beside it, move traffic over, then demolish the old one.

**Steps for renaming \`givenName\` → \`firstName\` (the book's breaking-change example)**
1. **Expand:** the server accepts both fields on input and returns **both** on output (\`givenName\` marked deprecated in the spec). Nothing breaks.
2. **Migrate:** update first-party clients; notify third parties; **measure** who still reads/sends the old field (per client ID, via logging which request fields are present, or response-field usage in SDK telemetry).
3. **Contract:** after usage reaches zero (or the sunset date), stop accepting/returning \`givenName\`. For public APIs this may only happen in the next major version.

**The same pattern everywhere**
- **Databases:** add column → dual-write → backfill → switch reads → stop writing old → drop column. Each step is independently deployable and reversible.
- **Events:** add the new field to the schema (compatible), producers emit both, consumers migrate, then remove the old field under the registry's compatibility rules.
- **Endpoints:** add \`/v2/orders\`, route traffic, deprecate \`/v1\`.

**Rules**
- Each step is a **separate deployment** — never expand and contract in one release, because old instances and new instances coexist during rolling deploys and old clients coexist for months.
- Keep the old and new representations semantically identical during the overlap (write-through mapping), or clients will see inconsistencies.
- The contract step needs **evidence** (usage metrics), not hope.`,
      diagram: `  time --->
  v1.4 (expand)          v1.5..v1.9 (migrate)            v2 or sunset (contract)
  +------------------+   +--------------------------+    +------------------+
  | givenName  (dep) |   | usage of givenName:      |    |                  |
  | firstName  (new) |   |  web 0%  ios 3%  acme 41%|    | firstName only   |
  +------------------+   +--------------------------+    +------------------+
   both accepted +        chase remaining clients,         remove after usage
   returned               Deprecation/Sunset headers       reaches 0 / sunset`,
      code: [
        {
          language: 'typescript',
          title: 'Expand phase: accept either field, return both, record legacy usage',
          code: `import { Counter } from 'prom-client';

const legacyFieldUse = new Counter({
  name: 'api_legacy_field_usage_total',
  help: 'Requests still sending deprecated fields',
  labelNames: ['field', 'client_id'],
});

interface AttendeeInput { firstName?: string; givenName?: string; surname: string }

export function normaliseInput(body: AttendeeInput, clientId: string) {
  if (body.givenName !== undefined) legacyFieldUse.inc({ field: 'givenName', client_id: clientId });
  const firstName = body.firstName ?? body.givenName;          // accept either
  if (firstName === undefined) throw new Error('firstName is required');
  if (body.firstName && body.givenName && body.firstName !== body.givenName) {
    throw new Error('firstName and givenName conflict');       // ambiguous: reject explicitly
  }
  return { firstName, surname: body.surname };
}

export function toResponse(a: { id: string; firstName: string; surname: string }) {
  return {
    id: a.id,
    firstName: a.firstName,
    givenName: a.firstName,   // deprecated mirror, removed in the contract phase
    surname: a.surname,
  };
}`,
        },
      ],
      keyPoints: [
        'Expand (both), migrate (measure), contract (remove) — separate deployments.',
        'Same pattern for DB columns, events and endpoints.',
        'Only contract with usage evidence.',
      ],
    },
    {
      heading: '5. Deprecation and sunset',
      body: `**Intuition:** closing a road needs signs months in advance, detours, and a date — not a surprise barrier.

**Signals to consumers**
- **\`Deprecation\` header (RFC 9745)** — structured-field date when the resource was/will be deprecated, e.g. \`Deprecation: @1767225599\` (Unix seconds). Deprecation means "still works, stop building on it".
- **\`Sunset\` header (RFC 8594)** — HTTP-date after which it may stop responding, e.g. \`Sunset: Thu, 31 Dec 2026 23:59:59 GMT\`.
- **\`Link\`** to the migration guide: \`Link: <https://developer.acme.com/migrate/v2>; rel="deprecation"\` (and \`rel="sunset"\` for the policy).
- OpenAPI \`deprecated: true\` on operations/fields; GraphQL \`@deprecated(reason:)\`; protobuf \`[deprecated = true]\`.
- Changelog, email to registered developers, dashboard banners.

**Process that actually works**
1. **Measure usage per client** (API key/OAuth client) for the deprecated endpoint/field — you can't sunset what you can't see.
2. **Announce** with a date that fits your policy (e.g. ≥ 6 months public, ≥ 1 month internal).
3. **Help migrate**: SDK releases, codemods, side-by-side docs, direct outreach to the top 20 users (usually > 90% of traffic).
4. **Brownouts**: scheduled short windows (e.g. 10 minutes, then 1 hour) where the old version returns 410 or 503 with a clear message — flushes out forgotten integrations before the real sunset (GitHub used this for API/auth deprecations).
5. **Sunset**: return **410 Gone** with a problem body pointing to the new version; keep the error for months rather than a 404.

**Internal APIs:** same idea, faster timeline; contract tests (Pact) tell you exactly which consumers still use the field, and \`can-i-deploy\` prevents removing it early.`,
      code: [
        {
          language: 'typescript',
          title: 'Middleware: deprecation headers, per-client usage metrics, brownouts and 410 after sunset',
          code: `import type { Request, Response, NextFunction } from 'express';
import { Counter } from 'prom-client';

const deprecatedCalls = new Counter({
  name: 'api_deprecated_calls_total', help: 'Calls to deprecated routes', labelNames: ['route', 'client_id'],
});

interface Policy { deprecatedAt: Date; sunsetAt: Date; docs: string; brownouts: Array<[Date, Date]> }

export function deprecated(route: string, p: Policy) {
  return (req: Request & { clientId?: string }, res: Response, next: NextFunction) => {
    const now = new Date();
    deprecatedCalls.inc({ route, client_id: req.clientId ?? 'unknown' });

    const gone = { type: 'https://developer.acme.com/problems/sunset', title: 'This API version is retired',
      status: 410, detail: 'Migrate to /v2 — see ' + p.docs };
    if (now >= p.sunsetAt) return res.status(410).type('application/problem+json').json(gone);
    if (p.brownouts.some(([from, to]) => now >= from && now < to)) {
      return res.status(410).type('application/problem+json').json({ ...gone, detail: 'Scheduled brownout. ' + gone.detail });
    }

    res.setHeader('Deprecation', '@' + Math.floor(p.deprecatedAt.getTime() / 1000)); // RFC 9745
    res.setHeader('Sunset', p.sunsetAt.toUTCString());                              // RFC 8594
    res.setHeader('Link', '<' + p.docs + '>; rel="deprecation"');
    next();
  };
}`,
        },
      ],
      keyPoints: [
        'Deprecation (RFC 9745) + Sunset (RFC 8594) + Link to docs.',
        'Measure usage per client; outreach to top consumers; brownouts before sunset.',
        'After sunset return 410 with a helpful problem body.',
      ],
    },
    {
      heading: '6. Detecting breaking changes automatically',
      body: `**Intuition:** humans miss breaking changes in code review; diff tools don't. Make the pipeline refuse to ship them unless the version is bumped.

**OpenAPI diff** — the book demonstrates \`openapitools/openapi-diff\` in Docker: renaming \`givenName\` → \`firstName\` reports *"API changes broke backward compatibility"* (missing property), while adding \`age\` reports *"API changes are backward compatible"*. Its caution: tools are often OpenAPI-version specific, so check support for the spec version you use. Popular options: **openapi-diff**, **oasdiff** (\`oasdiff breaking base.yaml head.yaml --fail-on ERR\`), Optic.

**Protobuf** — **\`buf breaking --against '.git#branch=main'\`** checks wire and source compatibility rules (field number/type changes, removed fields without reservation, enum changes) at configurable strictness (FILE, PACKAGE, WIRE_JSON, WIRE).

**GraphQL** — **graphql-inspector diff** or schema checks in a registry (e.g. Apollo/Hive) that also consult **real operation usage**: removing a field nobody has queried in 30 days is allowed; removing one in use is blocked.

**Event schemas** — schema registry compatibility modes (BACKWARD, FORWARD, FULL) reject incompatible Avro/Protobuf/JSON Schema versions at publish time.

**Where it runs:** on every PR that touches a spec. Break → fail, unless the PR also bumps the major version (a deliberate, reviewed decision). Store the spec in the repo next to the code, and generate/verify it from the implementation to avoid drift (a spec that doesn't match the running service is worse than none — add runtime request/response validation or contract tests).

**What diff tools can't see:** behavioural changes (sort order, default page size, a field now always null, different error semantics). Those need contract and component tests.`,
      code: [
        {
          language: 'yaml',
          title: 'GitHub Actions: block breaking changes in OpenAPI and protobuf',
          code: `name: api-compat
on: [pull_request]
jobs:
  openapi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Extract base spec
        run: git show origin/main:api/openapi.yaml > /tmp/base.yaml
      - name: Detect breaking changes (openapi-diff, as in Mastering API Architecture)
        run: |
          docker run --rm -v /tmp:/base:ro -v "$PWD/api":/head:ro \\
            openapitools/openapi-diff:latest /base/base.yaml /head/openapi.yaml --fail-on-incompatible
  protobuf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: bufbuild/buf-action@v1
        with:
          lint: true
          breaking: true
          breaking_against: '\${{ github.event.repository.clone_url }}#branch=main'`,
        },
      ],
      keyPoints: [
        'openapi-diff/oasdiff, buf breaking, graphql-inspector, schema registry modes.',
        'Fail CI on breaking changes unless the major version is deliberately bumped.',
        'Diff tools miss behavioural changes — contract tests cover those.',
      ],
      source: 'Mastering API Architecture — Ch 1 (OpenAPI Specification and Versioning)',
    },
    {
      heading: '7. Protobuf field evolution rules',
      body: `**Intuition:** in protobuf the *number* next to each field is its identity on the wire. Names are for humans (and for JSON).

The book stresses that with binary protocols the **position and numbering** of fields govern the message layout, so gRPC contracts must be much stricter than OpenAPI ones: adding a service, method or field is compatible (new fields must not be mandatory); removing/renaming a field, changing its type or changing its number breaks compatibility.

| Change | Wire (binary) | JSON mapping | Verdict |
|---|---|---|---|
| Add a new field with a new number | ✓ old readers skip unknown fields | ✓ | Safe |
| Remove a field | ✓ if its number/name are \`reserved\` | ✓ if reserved | Safe **only** with \`reserved\` |
| Reuse an old field number for a new field | ✗ old data decoded as the wrong field | ✗ | Never |
| Rename a field (same number) | ✓ | ✗ JSON uses field names | Breaking for JSON/grpc-gateway clients |
| Change type (\`int32\` → \`string\`) | ✗ | ✗ | Breaking |
| \`int32\` ↔ \`int64\` / \`uint32\` | Wire-compatible, but values may truncate | — | Avoid |
| Add enum value | ✓ (old readers see unknown value) | ✓ | Safe if clients handle unknown values; first value must be \`*_UNSPECIFIED = 0\` |
| Move field into/out of a \`oneof\` | Risky: can lose data | — | Avoid |
| Change a message's package/name | Breaks \`Any\` types and service paths | — | Breaking |

**proto3 presence:** scalar fields default to zero values; you can't tell "unset" from 0 unless you declare the field \`optional\` (proto3 ≥ 3.15) or use wrapper types. Design new fields as \`optional\` when "absent" means something.

**Never generate protos with auto-assigned numbers** (e.g. alphabetical ordering from an OpenAPI converter) — adding one field renumbers the rest and silently corrupts decoding (book, Multiple Specifications).

**Package versioning:** put the major version in the package (\`acme.orders.v1\`) so a v2 service can run side by side; within v1 only compatible changes (buf's \`PACKAGE\` or \`WIRE_JSON\` rules enforce this).`,
      code: [
        {
          language: 'protobuf',
          title: 'Evolving a message safely',
          code: `syntax = "proto3";
package acme.attendees.v1;

message Attendee {
  int64 id = 1;
  string given_name = 2 [deprecated = true];  // keep until all readers moved to first_name
  string surname = 3;
  // string email = 4;   REMOVED — reserve number AND name so nobody reuses them
  reserved 4;
  reserved "email";
  string first_name = 5;                        // new field, new number (expand phase)
  optional int32 age = 6;                       // explicit presence: unset != 0
  AttendeeType type = 7;
}

enum AttendeeType {
  ATTENDEE_TYPE_UNSPECIFIED = 0;  // required zero value; also what old readers see for unknowns
  ATTENDEE_TYPE_SPEAKER = 1;
  ATTENDEE_TYPE_SPONSOR = 2;
  ATTENDEE_TYPE_VOLUNTEER = 3;    // added later: clients must handle unknown/unspecified gracefully
}`,
        },
      ],
      keyPoints: [
        'Field numbers are the contract: never change or reuse — reserve removed ones.',
        'Add fields freely; don\'t change types; renames break JSON mapping.',
        'Enums need UNSPECIFIED = 0; use optional for presence; version the package.',
      ],
      source: 'Mastering API Architecture — Ch 1 (Implementing RPC with gRPC, Multiple Specifications)',
    },
    {
      heading: '8. Testing strategy for APIs: quadrant and pyramid',
      body: `**Intuition:** you want most of your confidence from fast, cheap, precise tests, and only a thin layer from slow, expensive, broad ones.

**The test quadrant** (Brian Marick's agile testing quadrants, used by the book): tests are *technology-facing vs business-facing* and *supporting the team vs critiquing the product*. Q1 = unit/component (automated, technology-facing), Q2 = functional/story tests (automated + manual, business-facing), Q3 = exploratory/usability (manual, business-facing, critiquing), Q4 = performance/security/"-ility" testing (tools, technology-facing, critiquing). It ensures you think about *all* kinds of quality, not just unit tests.

**The test pyramid** (book Figure 2-3): proportion of tests desired.
- **Unit tests** (base, most numerous) — small isolated units with test doubles; fastest, best isolation; Q1.
- **Service tests** (middle) — **component**, **contract** and **integration** tests; more confidence, more cost; Q1, Q2, Q4.
- **End-to-end** (top, fewest) — request flows through the whole system; most confidence per test, slowest and hardest to maintain; Q2–Q4.

The book warns against the **ice-cream cone** anti-pattern (mostly E2E): it *feels* safe but is slow, flaky and gives late feedback (citing Steve Smith's "End-to-End Testing Considered Harmful" and Martin Fowler on test shapes).

**For an API microservice the middle layer does the heavy lifting**
| Test | Scope | Real dependencies? | Catches |
|---|---|---|---|
| Component | The service in isolation via its API (HTTP), external services stubbed | Usually real DB via Testcontainers; downstream APIs stubbed (WireMock/Prism/Pact stubs) | Business behaviour through the real HTTP layer, serialisation, validation, status codes |
| Contract | Interaction between one consumer and one provider | No — each side tested alone against the contract | Integration mismatches without deploying both |
| Integration | Your adapter vs a real external thing (Postgres, Kafka, S3, a partner sandbox) | Yes, real (containers) | SQL/driver/config issues, migrations, serialization to Kafka |
| E2E | Key user journeys across deployed services | Everything | Wiring/config/infra issues; keep to a handful of critical paths |

**Book's ADR guideline for testing strategy:** can stakeholders regularly discuss how the API should behave? Do you have the skills (or time to train)? Are there mandated internal practices? Recommendation: use the quadrant and pyramid; at minimum automate the pyramid.`,
      diagram: `                 /\\
                /E2E\\          few: critical journeys only
               /------\\
              / Contract\\      per consumer-provider interaction
             / Component \\     service via HTTP, deps stubbed
            / Integration \\    adapters vs real Postgres/Kafka (containers)
           /---------------\\
          /      Unit       \\  many, fast, isolated
         /-------------------\\
   speed & isolation ^           confidence & scope v (per test)`,
      keyPoints: [
        'Quadrant ensures all quality dimensions; pyramid sets proportions.',
        'Component + contract + integration tests are the backbone for API services.',
        'Avoid the ice-cream cone of E2E-heavy suites.',
      ],
      source: 'Mastering API Architecture — Ch 2 (Test Quadrant, Test Pyramid, ADR Guideline)',
    },
    {
      heading: '9. Consumer-driven contract testing with Pact',
      body: `**Intuition:** instead of the provider guessing what consumers use, each consumer writes down "these are the requests I make and the parts of the responses I rely on". The provider runs those examples against itself on every build.

**Contract vs schema (book's warning):** schema conformance (does the response match the OpenAPI schema?) is not the same as a contract. A contract is a *defined interaction between parties with examples* — it captures that the consumer sends \`GET /attendees?conference=1234\` and relies on \`value[].id\` and \`givenName\`, which a schema alone doesn't express.

**Producer contracts vs consumer-driven contracts (book)**
- **Producer contracts** — the provider defines contracts itself; typical when consumers are external third parties (e.g. Microsoft Graph with thousands of consumers). Easier to start with.
- **Consumer-driven contracts (CDC)** — consumers submit contracts (or changes) to the provider — an interactive, social process, best **when consumers and producers are in the same organisation**. Tools: **Pact** (consumer-driven, language-agnostic, with a broker) and **Spring Cloud Contract** (the book's examples; producer or consumer driven, JVM-centric).

**Pact flow**
1. **Consumer test:** the consumer's client code runs against a Pact mock server that returns the expected responses; interactions are recorded into a pact file (JSON). Use **matchers** (\`like\`, \`eachLike\`, \`integer\`) so the contract specifies types/shape, not exact values.
2. **Publish** the pact to a **Pact Broker/PactFlow**, tagged with the consumer's version, branch and deployments.
3. **Provider verification:** the provider CI replays every relevant consumer's interactions against the real provider (with **provider states** to set up data: "order ord_1 exists") and publishes results.
4. **\`can-i-deploy\`**: before deploying either side, ask the broker whether this version is compatible with what's deployed in the target environment. Also enables **webhooks**: a changed pact triggers the provider build.

**Good practices**
- Contract only what the consumer actually uses (Postel's law); don't test provider business logic via contracts — the book notes frameworks discourage scenario tests in contracts (use component tests instead).
- Provider-side, stub the provider's *own* downstream dependencies during verification.
- It removes the need for a shared integration environment to catch most integration bugs.`,
      code: [
        {
          language: 'typescript',
          title: 'Consumer side (checkout-web → orders-api) with PactV3 and matchers',
          code: `import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { OrdersClient } from '../src/orders-client';

const { like, integer, eachLike, regex } = MatchersV3;

const provider = new PactV3({ consumer: 'checkout-web', provider: 'orders-api', dir: './pacts' });

describe('OrdersClient', () => {
  it('fetches an order with its line items', async () => {
    provider
      .given('order ord_1 exists')                                 // provider state
      .uponReceiving('a request for order ord_1')
      .withRequest({ method: 'GET', path: '/v1/orders/ord_1', headers: { Accept: 'application/json' } })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': regex('application/json.*', 'application/json') },
        body: {
          id: like('ord_1'),                                         // any string
          status: regex('PLACED|PAID|SHIPPED', 'PLACED'),
          totalCents: integer(1999),                                 // any integer
          items: eachLike({ sku: like('sku-1'), quantity: integer(1) }),
          // only fields this consumer uses are in the contract
        },
      });

    await provider.executeTest(async (mock) => {
      const order = await new OrdersClient(mock.url).getOrder('ord_1');
      expect(order.totalCents).toBe(1999);
      expect(order.items[0].quantity).toBe(1);
    });
  });
});`,
        },
        {
          language: 'typescript',
          title: 'Provider side (orders-api) verification + can-i-deploy gate',
          code: `import { Verifier } from '@pact-foundation/pact';
import { startApp, seedOrder, resetDb } from './test-helpers';

describe('orders-api pact verification', () => {
  it('honours all deployed consumers\\' contracts', async () => {
    const app = await startApp({ port: 4010 });    // real app, real DB (Testcontainers), downstreams stubbed
    try {
      await new Verifier({
        provider: 'orders-api',
        providerBaseUrl: 'http://localhost:4010',
        pactBrokerUrl: process.env.PACT_BROKER_URL,
        pactBrokerToken: process.env.PACT_BROKER_TOKEN,
        consumerVersionSelectors: [{ mainBranch: true }, { deployedOrReleased: true }],
        providerVersion: process.env.GIT_SHA,
        providerVersionBranch: process.env.GIT_BRANCH,
        publishVerificationResult: process.env.CI === 'true',
        stateHandlers: {
          'order ord_1 exists': async () => { await resetDb(); await seedOrder({ id: 'ord_1', totalCents: 1999 }); },
        },
      }).verifyProvider();
    } finally {
      await app.close();
    }
  });
});

// CI, before deploying orders-api to production:
//   pact-broker can-i-deploy --pacticipant orders-api --version $GIT_SHA --to-environment production`,
        },
      ],
      keyPoints: [
        'Contract = interaction with examples, not just schema conformance.',
        'Producer contracts for external consumers; CDC inside an organisation.',
        'Matchers, provider states, broker, can-i-deploy; don\'t put scenario logic in contracts.',
      ],
      source: 'Mastering API Architecture — Ch 2 (Contract Testing)',
    },
    {
      heading: '10. Component and integration tests with stubs and Testcontainers',
      body: `**Intuition:** test your service the way clients see it (over HTTP), with a *real* database in a throwaway container, and fake only the things you don't own.

**Component tests** exercise the whole service through its API with external services replaced by **stub servers** — WireMock, Prism (mock from an OpenAPI spec), or Pact stubs generated from contracts (the book shows stub servers generated from contracts so consumers can develop against them before the provider exists). The book's example tool for REST component tests is REST-assured (Java); in Node use Supertest or plain fetch against the booted app.

**Integration tests** verify your adapters against the real technology: SQL queries and migrations on the real Postgres version, Kafka serialisation, S3 multipart behaviour. **Testcontainers** starts disposable Docker containers from test code, waits for readiness, and gives you a connection URI — so you never test against H2/SQLite pretending to be Postgres (different SQL, locking and JSONB behaviour).

**Tips**
- Start containers **once per test file/suite** (seconds), and reset state per test (truncate tables or transaction rollback) for speed.
- Run migrations against the container — this doubles as a migration test.
- Pin image versions to production's (\`postgres:16.4\`), not \`latest\`.
- For Kafka use \`@testcontainers/kafka\` (or Redpanda) and assert on produced messages.
- Keep E2E suites small; most bugs they'd catch are caught earlier by these tests.`,
      code: [
        {
          language: 'typescript',
          title: 'Component test: NestJS app + real Postgres (Testcontainers) + stubbed downstream',
          code: `import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nock from 'nock';
import { AppModule } from '../src/app.module';
import { runMigrations } from '../src/db/migrate';

let pg: StartedPostgreSqlContainer;
let app: INestApplication;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16.4-alpine').start();   // same major as prod
  process.env.DATABASE_URL = pg.getConnectionUri();
  await runMigrations(process.env.DATABASE_URL);                           // also tests migrations
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  await app.init();
}, 60_000);

afterAll(async () => { await app.close(); await pg.stop(); });

it('creates an order and returns 201 with Location, pricing stubbed', async () => {
  nock('http://pricing.internal').get('/v1/prices/sku-1').reply(200, { sku: 'sku-1', cents: 1999 });

  const res = await request(app.getHttpServer())
    .post('/v1/orders')
    .set('Idempotency-Key', 'k-123')
    .send({ items: [{ sku: 'sku-1', quantity: 1 }] })
    .expect(201);

  expect(res.headers.location).toMatch(/^[/]v1[/]orders[/]/);
  expect(res.body.totalCents).toBe(1999);

  // Retrying with the same key must replay, not create a second order
  const again = await request(app.getHttpServer()).post('/v1/orders')
    .set('Idempotency-Key', 'k-123').send({ items: [{ sku: 'sku-1', quantity: 1 }] }).expect(201);
  expect(again.body.id).toBe(res.body.id);
});`,
        },
      ],
      keyPoints: [
        'Component tests: service via HTTP, real DB, stubbed external services.',
        'Testcontainers: real Postgres/Kafka versions, disposable, migrations tested.',
        'Reset state per test; pin images to production versions.',
      ],
      source: 'Mastering API Architecture — Ch 2 (Component Testing, Integration Testing, Testcontainers)',
    },
    {
      heading: '11. Strangler fig and facades: evolving a monolith\'s API',
      body: `**Intuition:** the strangler fig grows around a host tree until it can stand on its own. You put a new "front door" in front of the monolith and move rooms behind it one at a time, while visitors keep using the same door.

**Pattern (Mastering API Architecture Ch 8, after Martin Fowler)**
1. **Introduce a facade/gateway** in front of the monolith that initially proxies *everything* unchanged. Clients switch to the gateway's address once; the API contract doesn't change.
2. **Pick a seam** — a bounded capability with clear data ownership (often the endpoint causing the most pain, e.g. search, notifications).
3. **Build the new service** implementing the *same external contract* for those routes (contract tests against the existing behaviour are gold here).
4. **Route incrementally** at the gateway: shadow traffic (mirror, compare responses, discard), then canary a % of real traffic, then 100%.
5. **Migrate the data** — the hardest part: sync via CDC from the monolith DB, or make the new service the owner and have the monolith call it.
6. **Remove** the dead code from the monolith. Repeat.

**Facade / anti-corruption layer:** when the legacy API is awkward (SOAP, chatty, inconsistent), a facade exposes the clean new contract and translates to the old system underneath. New consumers bind to the facade; later the implementation behind it is replaced without them noticing. The book also notes GraphQL can serve as such a facade over legacy systems.

**Risks**
- Two systems writing the same data during migration → pick a single owner per entity at every point in time.
- Latency of an extra hop (~1 ms in-region) and the gateway as a critical dependency.
- Never-finished migrations: track the percentage of routes/traffic migrated as a metric with an end date.`,
      diagram: `  Phase 1                 Phase 2                     Phase 3
  clients                 clients                     clients
     |                       |                           |
  [gateway] --all-->      [gateway]                   [gateway]
     |                   /         \\                  /    |    \\
  [monolith]      /search -> [search-svc]   [search] [orders] [users]
                  rest    -> [monolith]              (monolith retired)
                     shadow: mirror /search to new svc, diff responses`,
      code: [
        {
          language: 'yaml',
          title: 'Envoy route: canary 10% of /v1/search to the new service, mirror the rest',
          code: `route_config:
  virtual_hosts:
    - name: public-api
      domains: ['api.example.com']
      routes:
        - match: { prefix: /v1/search }
          route:
            weighted_clusters:
              clusters:
                - { name: search-svc, weight: 10 }   # canary: 10% real traffic
                - { name: monolith, weight: 90 }
            # shadow: copy requests to the new service, responses discarded
            request_mirror_policies:
              - cluster: search-svc
                runtime_fraction: { default_value: { numerator: 100, denominator: HUNDRED } }
            timeout: 2s
        - match: { prefix: / }
          route: { cluster: monolith }             # everything else unchanged`,
        },
      ],
      keyPoints: [
        'Gateway/facade first, then move routes one at a time behind the same contract.',
        'Shadow → canary → full cutover; contract tests pin existing behaviour.',
        'Data ownership migration is the hard part; track progress to completion.',
      ],
      source: 'Mastering API Architecture — Ch 8 (Strangler Fig, Facades)',
    },
    {
      heading: '12. Fitness functions and scenarios',
      body: `**Intuition:** a fitness function is an automated test for an *architectural* property — "no breaking API change reaches production", "p99 of GET /orders stays < 200 ms" — so the architecture can evolve without eroding.

**Fitness functions for API evolution** (Building Evolutionary Architectures, referenced by the book)
- Breaking-change diff gate on every PR (OpenAPI/proto/GraphQL).
- \`can-i-deploy\` gate before each deployment.
- Spec–implementation drift check (runtime validation or generated-spec comparison).
- Deprecated-endpoint usage trending to zero before sunset date (alert if not).
- Latency/payload budgets per endpoint in performance tests.
- Linting rules: naming conventions, pagination envelope, problem+json errors (e.g. Spectral rulesets).

**Scenario: the API version needs to change without breaking clients**
1. Can it be additive? Add fields/endpoints, keep old semantics → minor version, no client action.
2. If a representation must change: **expand** (serve both shapes; new fields or v2 route/header), keep the domain core version-agnostic with per-version mappers.
3. Publish the new version in the spec + SDKs; mark old as deprecated; **Deprecation/Sunset** headers; measure usage per client.
4. Migrate first-party clients, then outreach; brownouts; sunset with 410.
5. Contract tests + diff gates guarantee nothing else broke along the way.

**Scenario: one endpoint is overloaded** (e.g. \`/search\` is 70% of monolith DB load)
- Short term: cache results, rate-limit that endpoint per client, add a read replica or a dedicated connection pool (bulkhead) so it can't starve checkout.
- Evolution: **strangle** it — route \`/search\` via the gateway to a new service backed by a search index (fed by CDC), same external contract, verified by shadow traffic and contract tests; later evolve its contract (cursor pagination, field selection) through a new minor/major version without touching the rest of the API.`,
      keyPoints: [
        'Fitness functions automate architectural guarantees in CI/CD.',
        'Version changes: additive first, else expand-deprecate-measure-contract.',
        'Overloaded endpoint: protect short term, strangle into its own service behind the same contract.',
      ],
      source: 'Mastering API Architecture — Ch 8; Building Evolutionary Architectures',
    },
  ],
  codeChallenges: [
    {
      id: 'api-evolution-cc-1',
      title: 'A "minor" release that broke three mobile app versions',
      context:
        'Release 1.8 of the Attendee API shipped these changes as a MINOR version because "the fields are basically the same". Within an hour, older iOS builds crashed on the attendee screen, a partner integration started getting 400s, and the Android app showed "Unknown" for every attendee type.',
      task:
        'Identify every breaking change in the 1.8 diff and rework the release so it is genuinely backward compatible (expand phase), with a path to eventually remove the old shapes.',
      starter: {
        language: 'typescript',
        code: `// v1.7 response: { id: 42, givenName: 'Jane', surname: 'Doe', type: 'SPEAKER', ticketPrice: '199.00' }

// v1.8 DTOs (shipped as a minor release)
export class CreateAttendeeDto {
  @IsString() firstName!: string;          // was givenName
  @IsString() surname!: string;
  @IsEmail() email!: string;               // NEW and required
}

export function toResponse(a: Attendee) {
  return {
    id: String(a.id),                      // was a number
    firstName: a.firstName,                // givenName removed
    surname: a.surname,
    type: a.type,                          // new value 'VOLUNTEER' added
    ticketPrice: { amount: a.priceCents, currency: 'EUR' },   // was a string
  };
}`,
      },
      hints: [
        'Go field by field: which changes affect old clients reading responses, and which affect old clients sending requests?',
        'An old client has an exhaustive switch over attendee types. What happens with a value it has never seen?',
        'How can a response carry both the old and the new representation of the price during the migration?',
      ],
      solution: {
        language: 'typescript',
        code: `// v1.8 done right: expand only. Old clients see exactly what they saw in 1.7, plus new fields.
export class CreateAttendeeDto {
  @IsOptional() @IsString() firstName?: string;
  /** @deprecated use firstName — accepted until the v2 sunset */
  @IsOptional() @IsString() givenName?: string;
  @IsString() surname!: string;
  @IsOptional() @IsEmail() email?: string;       // new inputs must be optional within a major
}

export function normalise(dto: CreateAttendeeDto) {
  const firstName = dto.firstName ?? dto.givenName;
  if (!firstName) throw new UnprocessableEntityException('firstName is required');
  return { firstName, surname: dto.surname, email: dto.email ?? null };
}

// Old clients only know these; new values are mapped for them (tolerant for old readers)
const V1_TYPES = new Set(['SPEAKER', 'SPONSOR', 'ATTENDEE']);

export function toResponse(a: Attendee, opts: { clientSupportsNewTypes: boolean }) {
  return {
    id: a.id,                                    // unchanged type (number)
    idStr: String(a.id),                         // new: string form for clients that need it
    givenName: a.firstName,                      // deprecated mirror (same value)
    firstName: a.firstName,                      // new
    surname: a.surname,
    // New enum values only for clients that declared support (e.g. Api-Features: attendee-types-v2)
    type: opts.clientSupportsNewTypes || V1_TYPES.has(a.type) ? a.type : 'ATTENDEE',
    attendeeType: a.type,                        // new field always carries the full value
    ticketPrice: (a.priceCents / 100).toFixed(2), // unchanged legacy string
    ticketPriceMoney: { amount: a.priceCents, currency: 'EUR' },   // new structured amount
  };
}
// Spec: mark givenName/ticketPrice/type as deprecated, add Deprecation/Sunset headers,
// track usage per client, and remove them only in v2 after usage hits zero.`,
      },
      explanation: `**Breaking changes in the original 1.8:**

1. **Rename \`givenName\` → \`firstName\`** in requests *and* responses — old clients sent a field that's now ignored (validation fails) and read a field that no longer exists.
2. **New required \`email\` input** — every old client's create request now gets 400.
3. **\`id\` number → string** — typed clients (Swift \`Codable\`, Kotlin data classes) fail to decode the whole object → the iOS crash.
4. **New enum value \`VOLUNTEER\`** — exhaustive switches and strict enum decoders crash or show "Unknown".
5. **\`ticketPrice\` string → object** — type change; decoders fail and anyone parsing "199.00" breaks.

**The fix is the expand phase of expand–contract:**
- Accept both \`givenName\` and \`firstName\`; new inputs optional within the major.
- Keep every old field with its old type and meaning; add *new* fields (\`firstName\`, \`idStr\`, \`ticketPriceMoney\`, \`attendeeType\`) for the new shapes.
- Protect old readers from new enum values (map to a safe value, or send new values only to clients that opt in), and document that clients must tolerate unknown values in the future.
- Deprecate old fields with headers/spec annotations and usage tracking; remove them only in the next major after usage drops to zero.
- Add openapi-diff to CI: this release would have been flagged as incompatible before shipping.`,
      followUps: [
        {
          "q": "How would you enforce in CI that the next 'minor' release can't contain these breaks?",
          "a": "Generate the OpenAPI spec from the code on every PR and run `openapi-diff` (or oasdiff) against the spec of the last released version, failing on any breaking change unless the PR also bumps the major. That catches the required `email`, the removed `givenName` and the `id` and `ticketPrice` type changes. Enum additions need an explicit rule (oasdiff flags response enum additions as a warning), and consumer pacts in the broker catch whatever the diff misses, such as old clients' expectations of `type`."
        },
        {
          "q": "You now have both `ticketPrice` and `ticketPriceMoney`. Six months later, how do you run the contract phase safely?",
          "a": "Mark `ticketPrice` deprecated in the spec and send `Deprecation` and `Sunset` headers on responses. Measure clients that still need it: app versions below the 1.8 adoption build, partner keys whose pacts still reference it, and SDK versions. Once those are below the support floor, remove it in v2 (a new major), or, if the API has a compatibility policy for deprecated fields, remove it after the announced sunset with brownouts first. Delete the mapper code in the same change so the old shape doesn't linger."
        }
      ],
    },
    {
      id: 'api-evolution-cc-2',
      title: 'Green tests, broken production: hand-written mocks drifted from the provider',
      context:
        'checkout-web tests its OrdersClient with a hand-written nock mock. The orders-api team renamed totalCents to amountCents and changed status values to lowercase in a refactor; all tests on both sides stayed green; checkout broke in production. The team\'s answer was a nightly E2E suite that takes 50 minutes and fails randomly ~30% of nights.',
      task:
        'Replace the drifting mock with a consumer-driven contract that the provider verifies, and gate deployments so this class of break cannot reach production — without relying on the E2E suite.',
      starter: {
        language: 'typescript',
        code: `// checkout-web/test/orders-client.spec.ts
import nock from 'nock';
import { OrdersClient } from '../src/orders-client';

it('reads an order total', async () => {
  // written by hand two years ago; nobody on orders-api knows this exists
  nock('http://orders.internal')
    .get('/v1/orders/ord_1')
    .reply(200, { id: 'ord_1', status: 'PLACED', totalCents: 1999, items: [] });

  const order = await new OrdersClient('http://orders.internal').getOrder('ord_1');
  expect(order.totalCents).toBe(1999);
});

// orders-api CI: unit tests + its own component tests — never sees the consumer's expectations
// Deploy pipeline: build -> unit tests -> deploy to prod (nightly E2E runs separately)`,
      },
      hints: [
        'Who owns the knowledge "checkout-web reads totalCents and expects status PLACED", and how could the provider\'s CI learn about it?',
        'How do you make the expectation about types/shape rather than the exact example values?',
        'What question should the deploy pipeline ask before releasing either service?',
      ],
      solution: {
        language: 'typescript',
        code: `// checkout-web/test/orders-client.pact.spec.ts — the expectation becomes a shared contract
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { OrdersClient } from '../src/orders-client';
const { like, integer, regex } = MatchersV3;

const pact = new PactV3({ consumer: 'checkout-web', provider: 'orders-api', dir: './pacts' });

it('reads an order total', async () => {
  pact.given('order ord_1 exists')
    .uponReceiving('get order ord_1')
    .withRequest({ method: 'GET', path: '/v1/orders/ord_1' })
    .willRespondWith({
      status: 200,
      body: { id: like('ord_1'), status: regex('PLACED|PAID|SHIPPED', 'PLACED'), totalCents: integer(1999) },
    });
  await pact.executeTest(async (mock) => {
    const order = await new OrdersClient(mock.url).getOrder('ord_1');
    expect(order.totalCents).toBe(1999);
  });
});

/* Pipelines

checkout-web CI:
  npm test                                   # generates pacts/checkout-web-orders-api.json
  pact-broker publish ./pacts --consumer-app-version $GIT_SHA --branch $GIT_BRANCH
  pact-broker can-i-deploy --pacticipant checkout-web --version $GIT_SHA --to-environment production
  deploy && pact-broker record-deployment --pacticipant checkout-web --version $GIT_SHA --environment production

orders-api CI (also triggered by a broker webhook when a consumer pact changes):
  npm run test:pact:verify                   # Verifier with consumerVersionSelectors
                                             #   [{ mainBranch: true }, { deployedOrReleased: true }]
  pact-broker can-i-deploy --pacticipant orders-api --version $GIT_SHA --to-environment production
  deploy && pact-broker record-deployment --pacticipant orders-api --version $GIT_SHA --environment production
*/

// The refactor (totalCents -> amountCents, lowercase statuses) now FAILS orders-api verification
// in the PR, naming the consumer and field. The team must expand first (return both fields,
// keep status values) and only contract once checkout-web's deployed pact no longer uses them.`,
      },
      explanation: `**Why the starter failed:** the consumer's expectations lived only in its own repo. The provider could change anything without a failing test; the consumer's mock kept returning the old shape forever — both suites green, production broken. The nightly E2E suite found issues too late (after deploy) and too noisily (flaky) to gate anything.

**What the fix does:**
- **Consumer-driven contract:** the same test now produces a pact describing exactly what checkout-web relies on (path, status regex, \`totalCents\` as an integer). Matchers specify types and formats, not literal values, so providers aren't coupled to example data.
- **Broker + provider verification:** orders-api replays every relevant consumer pact against the real service on each build (and when a consumer publishes a changed pact, via webhook). The rename fails in the provider's PR, naming the consumer and the field.
- **\`can-i-deploy\` + \`record-deployment\`:** each side can only deploy if its version is verified against the versions actually deployed in production — protecting both deployment orders.
- **Evolution path:** the failing verification forces expand–contract (serve both \`totalCents\` and \`amountCents\`) instead of a breaking rename.
- **E2E suite:** shrink it to a handful of critical journeys run post-deploy as smoke tests; contract + component tests carry the integration confidence (the book's pyramid instead of the ice-cream cone).`,
      followUps: [
        {
          "q": "orders-api has 15 consumers, each publishing pacts. Provider verification now takes 8 minutes. How do you keep the provider's CI fast?",
          "a": "Verify only what matters per build: consumer version selectors `{mainBranch: true}` and `{deployedOrReleased: true}`, not every branch. Enable `pending` pacts so a new consumer expectation doesn't fail the provider build until it has been verified once, and work-in-progress pacts for feature branches. Make state handlers cheap (transaction rollback, not full reseeding) and run interactions in parallel against several provider instances. Webhook-triggered verification of only the changed pact handles the consumer-side change path."
        },
        {
          "q": "The consumer can't deploy because orders-api hasn't verified its new pact yet, and the orders team is in another timezone. How do you avoid blocking?",
          "a": "That's working as designed: the consumer depends on something the provider doesn't yet support. To avoid waiting on people, the broker webhook triggers the provider's verification job automatically when a pact changes, so a result appears in minutes without anyone on the orders team. If verification fails, it's a real gap. The consumer can ship behind a feature flag that keeps using only already-verified interactions, and enable the new path once the provider ships support."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'api-evolution-iq-01',
      difficulty: 'hard',
      question:
        'We need to change how money is represented in our public API — from "price": "19.99" to a structured { amount, currency } — and we have ~2,000 third-party integrations. How do you ship this without breaking anyone?',
      whatInterviewerLooksFor: [
        'Recognises it as a breaking type change and avoids an in-place change',
        'Uses expand-contract within the major, or a new major with overlap',
        'Plans deprecation communication, usage measurement and sunset',
        'Protects with CI diff gates and contract tests',
      ],
      modelAnswer: `### Classify the change
Changing \`price\` from string to object is a **breaking type change** — typed clients will fail to decode. It can't ship in place under the same major.

### Plan A (preferred): expand within v1
- Add a **new field** \`priceMoney: { amount: 1999, currency: "EUR" }\` (minor units, ISO 4217) alongside the unchanged \`price: "19.99"\`. Requests accept either (\`priceMoney\` wins; reject conflicting values).
- Mark \`price\` deprecated in OpenAPI, SDKs and docs. Old clients are untouched; new clients adopt \`priceMoney\` immediately.
- Keep both forever if cheap, or remove \`price\` in the next major.

### Plan B: new major v2 if many changes are bundled
- \`/v2\` (or a dated version) with the clean representation; one domain core with per-version mappers so we don't fork the codebase.
- v1 remains supported for a published window (e.g. 12–18 months).

### Migration execution
1. **Measure**: per-client usage of \`price\` (request field presence; SDK version telemetry; v1 traffic per API key).
2. **Communicate**: changelog, email, dashboard banner, Deprecation + Sunset headers with Link to the migration guide.
3. **Enable**: new SDK releases with the new field; codemods/snippets; sandbox.
4. **Outreach** to the top integrators (typically 20 clients ≈ 90% of traffic).
5. **Brownouts** near the end for the old field/version; then sunset → 410 with a helpful problem body.

### Guardrails
- openapi-diff/oasdiff in CI flags the type change if anyone tries it in place.
- Contract tests for first-party consumers; examples in the spec validated.
- Rounding and currency semantics documented (minor units, no floats) and covered by tests.`,
      followUps: [
        {
          q: 'An integrator ignores all communication and is still on the old field at sunset. What now?',
          a: 'Escalate via account management, offer a short extension if they\'re strategic, run brownouts to force attention; ultimately return 410 on schedule — keeping deprecated contracts forever has real security and maintenance costs.',
        },
        {
          q: 'Why minor units (integers) rather than a decimal number?',
          a: 'Floating-point JSON numbers lose precision in many languages; integers in minor units plus a currency code are exact (watch currencies with 0 or 3 decimals).',
        },
      ],
      pitfalls: [
        'Changing the type in place and calling it a minor version',
        'Removing the old field without measuring usage',
        'Forking the codebase per version instead of mapping at the edge',
      ],
    },
    {
      id: 'api-evolution-iq-02',
      difficulty: 'medium',
      question:
        'URI versioning, header versioning, media-type versioning or Stripe-style dated versions — which do you choose for a new B2B platform API, and why?',
      whatInterviewerLooksFor: [
        'Knows trade-offs of each (visibility, caching, routing, tooling)',
        'Connects the choice to change frequency and consumer base',
        'Mentions defaults/pinning and Vary headers',
        'Emphasises additive evolution regardless of scheme',
      ],
      modelAnswer: `### Trade-offs
- **URI (/v1)**: explicit, visible in logs and docs, trivially routed by gateways and cached by CDNs; coarse — a new major tends to version everything at once.
- **Header (Api-Version)**: clean URIs, can vary per request; invisible in links, caches need \`Vary\`, easy to forget in curl/tests.
- **Media type (Accept: application/vnd.acme.v2+json)**: most HTTP-pure, versions a representation; weakest tooling and discoverability.
- **Dated versions pinned per account (Stripe)**: each account is pinned to the version at signup; breaking changes ship as small dated increments with a request/response **transformation layer**; consumers upgrade explicitly (and can test via header override). Excellent for platforms that must keep evolving without breaking thousands of integrators, but requires engineering investment and testing across many versions.

### My choice for a new B2B platform
- **URI major version** (\`/v1\`) as the coarse contract — simplest for customers, SDKs and gateways.
- **Strictly additive evolution within v1** (optional inputs, new fields, new endpoints), deprecations with headers, diff gates in CI.
- If we later find we need frequent small breaking changes, adopt **dated versions via header within the major** for fine-grained changes, pinned per client, with a default of the client's pinned version, never "latest".

### Details that matter
- Always return the served version in a response header.
- For header-based schemes send \`Vary: Api-Version\` (or \`Vary: Accept\`).
- Version the *contract*, not individual deployments; internal minor/patch versions live in the OpenAPI \`info.version\` and changelog.`,
      followUps: [
        {
          q: 'What does Stripe\'s approach require internally?',
          a: 'A single latest-version core plus a chain of version-change modules that transform requests/responses between adjacent versions, per-account pinned versions, and tests that run fixtures across versions.',
        },
        {
          q: 'How do you version GraphQL?',
          a: 'Typically you don\'t version the endpoint; evolve the schema additively with @deprecated fields and use usage-aware schema checks before removing anything.',
        },
      ],
      pitfalls: [
        'Defaulting unversioned requests to "latest"',
        'Treating the choice of scheme as more important than compatibility discipline',
        'Forgetting Vary with header-based versions',
      ],
    },
    {
      id: 'api-evolution-iq-03',
      difficulty: 'hard',
      question:
        'How do you make sure breaking API changes never reach production across REST, gRPC and GraphQL services in a 60-service org?',
      whatInterviewerLooksFor: [
        'Spec-in-repo and CI diff tools per technology',
        'Knows the limits of schema diffs (behavioural changes)',
        'Adds contract testing and deployment gates',
        'Governance: linting, ownership, exceptions process',
      ],
      modelAnswer: `### 1. Specs are code
- Every service owns its OpenAPI / .proto / GraphQL SDL in its repo; generated from or validated against the implementation so there's no drift (runtime request/response validation in non-prod, or generated-spec diff).

### 2. Static breaking-change gates on every PR
- **REST:** openapi-diff (the book's example) or oasdiff — fail on incompatible changes.
- **gRPC:** \`buf breaking --against main\` with WIRE_JSON rules (catches renamed fields that break JSON transcoding too) + \`buf lint\`.
- **GraphQL:** schema checks against **real operation usage** (graphql-inspector / registry) — removing an unused field is allowed, a used one blocked.
- **Events:** schema registry in BACKWARD/FULL mode.
- A breaking change only passes with an explicit major-version bump and API-review approval.

### 3. Behavioural compatibility
- Diffs miss semantic changes (sort order, defaults, error types, nullability in practice). Consumer-driven **contract tests (Pact)** capture what consumers rely on; providers verify all deployed consumers' pacts; **can-i-deploy** gates deploys.
- Component tests for key behaviours (pagination order, idempotency replay).

### 4. Runtime safety net
- Canary deploys with per-endpoint error-rate and 4xx/5xx deltas by client; automated rollback.
- Tolerant readers in first-party clients (ignore unknown fields, handle unknown enums).

### 5. Governance
- Spectral lint rules for naming, pagination envelopes, problem+json errors.
- Deprecation policy (minimum notice), API review for new majors, dashboard of deprecated-endpoint usage.

### Protobuf-specific rules I'd enforce
Never change/reuse field numbers (\`reserved\`), no type changes, enums with \`UNSPECIFIED = 0\`, package versioning (\`acme.orders.v1\`).`,
      followUps: [
        {
          q: 'A diff tool says "compatible" but a client still broke. How?',
          a: 'Behavioural change (e.g. default sort changed, a field that used to be always present became null, new enum value hit an exhaustive switch, stricter validation not expressed in the schema). Contract tests and tolerant readers address these.',
        },
        {
          q: 'Do contract tests replace the diff gate?',
          a: 'No — contracts only cover known consumers; public APIs have unknown consumers, so the diff gate protects them. Use both.',
        },
      ],
      pitfalls: [
        'Relying on code review alone',
        'Thinking schema diffs catch behavioural changes',
        'Specs maintained by hand, drifting from the implementation',
      ],
    },
    {
      id: 'api-evolution-iq-04',
      difficulty: 'expert',
      question:
        'Explain consumer-driven contract testing to me as if I\'m skeptical. When is it worth it, how does it work with Pact, and what are its failure modes?',
      whatInterviewerLooksFor: [
        'Clear mechanism: consumer tests generate contracts, provider verifies',
        'Knows broker, provider states, matchers, can-i-deploy',
        'Distinguishes from schema testing and from E2E',
        'Knows when producer contracts are better and the social aspect',
        'Honest about pitfalls',
      ],
      modelAnswer: `### The problem it solves
Integration bugs between services are usually caught late — in shared staging or E2E suites that are slow and flaky — or not at all, because each side's mocks drift from reality.

### Mechanism (Pact)
1. **Consumer test**: the consumer's real client code calls a Pact mock server configured with the expected interaction (request + the *parts* of the response it uses, with type matchers). Passing tests write a **pact file**.
2. Consumer CI **publishes** the pact to a broker with version, branch and environment metadata.
3. **Provider verification**: the provider's CI fetches pacts from consumers that matter (main branch + deployed versions), replays each request against the real provider (with **provider states** to seed data), and checks responses. Results are published back.
4. **can-i-deploy**: before deploying anything, the pipeline asks the broker whether this version is compatible with the versions deployed in the target environment. **record-deployment** keeps that matrix accurate.

### Why it's more than schema validation
The book's point: conforming to an OpenAPI schema ≠ fulfilling a contract. A contract is an interaction with examples — which endpoint, which params, which fields the consumer actually reads. It tells the provider exactly *who* breaks and *why*.

### When it's worth it
- Many internal consumers and providers owned by different teams, deploying independently — the book recommends **CDC inside an organisation**.
- For **external/third-party consumers**, use **producer contracts** (the provider publishes its contract, like Microsoft Graph) plus diff gates — you can't get pacts from unknown consumers.

### Failure modes
- **Over-specified contracts** (exact values, full response bodies) → brittle; use matchers and only include used fields.
- **Scenario/business logic in contracts** → the book warns against it; use component tests.
- **Provider states** becoming a second test-data framework; keep them small.
- **Not using can-i-deploy** → contracts become documentation, not a gate.
- **Social failure**: it's a conversation — consumers propose changes, providers review. Without ownership it rots.
- Async messaging needs message pacts too (Pact supports them).`,
      followUps: [
        {
          q: 'How does this let you drop the shared staging environment?',
          a: 'Each service is tested in isolation against contracts (consumer against provider stubs, provider against consumer expectations) and can-i-deploy verifies compatibility of the exact versions, so most integration bugs are caught without deploying everything together. Keep a small smoke test post-deploy.',
        },
        {
          q: 'A consumer wants a new field. What\'s the flow?',
          a: 'The consumer adds it to their pact on a branch and publishes; the provider sees a failing (pending) verification, discusses and implements it; once verified, the consumer can deploy. Pending/WIP pacts keep the provider build green while work is in progress.',
        },
      ],
      pitfalls: [
        'Equating contract tests with OpenAPI schema validation',
        'Asserting exact values everywhere',
        'Skipping the deployment gate',
      ],
    },
    {
      id: 'api-evolution-iq-05',
      difficulty: 'medium',
      question:
        'Your team\'s API service has 1,500 unit tests, no service tests, and a 45-minute E2E suite that fails randomly. Bugs still slip into production. How would you restructure the test strategy?',
      whatInterviewerLooksFor: [
        'Applies the test pyramid and recognises the ice-cream cone',
        'Introduces component, integration (Testcontainers) and contract tests',
        'Addresses flakiness and pipeline speed with numbers',
        'Uses the quadrant to cover non-functional testing',
      ],
      modelAnswer: `### Diagnosis
Classic hollow middle: units test internals with mocks (they pass even when SQL, serialisation, validation, HTTP status codes or integrations are wrong), and the E2E suite is the only thing testing real behaviour — slow, flaky and late.

### Target shape
1. **Keep unit tests** for domain logic, prune ones that just mirror implementation.
2. **Component tests (new backbone)**: boot the NestJS app, call it over HTTP (Supertest), real Postgres/Redis via **Testcontainers**, external APIs stubbed (WireMock/nock/Pact stubs). Cover each endpoint's contract: status codes, problem+json errors, pagination, idempotency replay, auth. ~150–300 tests, a few minutes in parallel.
3. **Integration tests** for adapters: repository SQL against real Postgres (same major version), Kafka producer/consumer serialisation, S3 client against LocalStack/MinIO; migrations applied in tests.
4. **Contract tests (Pact)** with each consumer and each provider we call; can-i-deploy in the pipeline.
5. **E2E**: shrink to 5–10 critical journeys as post-deploy smoke tests in staging/prod, with retries-on-infra-only and quarantine of flaky tests.

### Numbers
- 20 E2E tests at 2% flakiness each → P(all pass) = 0.98^20 ≈ 67%: a third of runs fail spuriously, so people ignore failures. Fewer, more reliable E2E tests restore trust.
- Pipeline target: < 10–15 minutes to production-ready signal.

### Quadrant check (book)
- Q4: add performance tests (k6) on key endpoints with latency budgets, security scans (ZAP/dependency audit).
- Q3: exploratory testing sessions before major releases.

### Rollout
Start with component tests for the endpoints that had production bugs; add Testcontainers infra once; make contract tests mandatory for new integrations.`,
      followUps: [
        {
          q: 'Testcontainers makes CI slower. Mitigations?',
          a: 'Start containers once per suite, reset state per test (truncate/transactions), run suites in parallel, use lightweight images (alpine), and reuse containers locally (reuse mode).',
        },
        {
          q: 'Why not use SQLite/H2 in tests for speed?',
          a: 'Different SQL dialect, locking, JSON and index behaviour — tests pass while production queries fail. Use the real engine and version.',
        },
      ],
      pitfalls: [
        'Adding more E2E tests to fix flakiness',
        'Mocking the database in "integration" tests',
        'No contract tests between independently deployed services',
      ],
    },
    {
      id: 'api-evolution-iq-06',
      difficulty: 'expert',
      question:
        'You must break a 10-year-old monolith\'s public API into microservices over 18 months. Customers must not notice. How do you do it?',
      whatInterviewerLooksFor: [
        'Strangler fig with a gateway/facade and incremental routing',
        'Contract preservation via characterisation/contract tests and shadow traffic',
        'Data ownership migration strategy (CDC, single writer)',
        'Measurable progress and rollback at each step',
      ],
      modelAnswer: `### Step 0 — freeze the contract you must preserve
- Write/derive an **OpenAPI spec** of the existing public API (from traffic capture if needed). Build **characterisation tests**: recorded real requests/responses replayed against any implementation to confirm identical behaviour (status codes, headers, error bodies, pagination quirks).

### Step 1 — put a facade in front
- API gateway (Envoy/Kong) proxies 100% to the monolith. Customers' DNS points at the gateway. No behaviour change — this is the only "big" switch and it's reversible.
- Add observability per route: traffic, latency, errors, top clients.

### Step 2 — choose seams
- Bounded capabilities with clear data ownership and high value: e.g. \`/search\` (70% of DB load), notifications, catalog reads.

### Step 3 — build and verify each new service
- Same external contract; internal contracts free to be better (gRPC east-west).
- **Shadow traffic**: mirror 100% of reads to the new service, diff responses offline (ignoring volatile fields), fix discrepancies until the diff rate < 0.1%.
- **Canary**: 1% → 10% → 50% → 100% of real traffic by route (and by tenant if useful), with automatic rollback on error-rate deltas.

### Step 4 — data
- Reads first: new service fed by **CDC** (Debezium) from the monolith DB into its own store.
- Writes: switch ownership — new service becomes the writer, monolith reads through its API or via CDC back. **One writer per entity at any time**; never dual-write from two codebases.

### Step 5 — retire and repeat
- Remove dead monolith code; track "% of routes/traffic served by new services" and a target date.

### Also
- The facade can fix API warts for *new* versions (a clean \`/v2\` served by new services) while \`/v1\` stays byte-compatible.
- Contract tests between the new services and their consumers from day one.`,
      followUps: [
        {
          q: 'Shadow traffic for writes?',
          a: 'Don\'t mirror writes to a system with side effects. Either mirror to a sandboxed instance with side effects stubbed, or verify writes through dual-run comparisons on a copy of the data.',
        },
        {
          q: 'What\'s the biggest risk?',
          a: 'Data migration and split ownership; second is never finishing (two systems forever). Mitigate with single-writer rules and a tracked migration backlog with deadlines.',
        },
      ],
      pitfalls: [
        'Big-bang rewrite with a cutover weekend',
        'Changing the external contract during the migration',
        'Dual writes from monolith and new service',
      ],
    },
    {
      id: 'api-evolution-iq-07',
      difficulty: 'hard',
      question:
        'The /reports endpoint in your monolith consumes 60% of the database and slows down every other endpoint. Product also wants to change its response format. How do you handle both the load and the evolution?',
      whatInterviewerLooksFor: [
        'Short-term isolation (bulkhead, caching, rate limits, replica)',
        'Strangler extraction behind the same contract',
        'Contract evolution done compatibly (new version/fields, deprecation)',
        'Fitness functions to keep it fixed',
      ],
      modelAnswer: `### Short term (days) — stop it hurting others
- **Bulkhead the DB access**: dedicated connection pool with a low max for /reports so it can't starve checkout; route its queries to a **read replica**.
- **Per-client rate/concurrency limits** on /reports; queue heavy reports as **async jobs** (202 + status resource) if the current contract allows, or behind an opt-in parameter.
- Cache report results for identical parameters (TTL minutes).

### Medium term (weeks) — extract with a strangler
- Gateway routes \`/reports\` to a new **reporting service** with its own read model (CDC from the monolith DB into a columnar/OLAP store or pre-aggregated tables).
- Preserve the **existing v1 contract** exactly: characterisation tests + shadow traffic diffing, then canary.
- The monolith DB load from /reports drops to ~0.

### Evolve the contract compatibly
- New format as **additive** fields or as \`/v2/reports\` (async by default: POST creates a report job, GET polls, results via pre-signed URL; cursor pagination for large result sets).
- v1 marked deprecated with Deprecation/Sunset headers; usage per client measured; SDKs updated; sunset after migration.
- Contract tests with internal consumers; openapi-diff gate for v1 (must remain unchanged).

### Keep it fixed — fitness functions
- Alert/CI check: DB CPU share per endpoint, p99 latency budget of checkout independent of reporting load (load test with reporting traffic injected), breaking-change gate on v1.`,
      followUps: [
        {
          q: 'Why not just make /reports async in v1?',
          a: 'Changing a synchronous 200-with-body contract into 202-with-job breaks every client. Do it in v2 or as an opt-in (e.g. Prefer: respond-async header) while v1 stays synchronous.',
        },
        {
          q: 'How do you check the new service returns identical results?',
          a: 'Shadow requests with response diffing (normalising ordering/volatile fields), sampled reconciliation of aggregates, and characterisation tests from recorded traffic.',
        },
      ],
      pitfalls: [
        'Changing the response format in place during the extraction',
        'Only scaling the database vertically',
        'Extracting without a way to verify behavioural equivalence',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'api-evolution-boe-1',
      question:
        'You deprecate v1 of an API used by 1,200 client applications; 30% of traffic is still on v1. Historically, remaining v1 traffic halves every 6 weeks after active outreach. When can you realistically sunset at < 0.5% of traffic, and what does keeping v1 cost meanwhile?',
      assumptions: [
        'Halving every 6 weeks with outreach',
        'Sunset threshold: < 0.5% of traffic (the remainder handled via brownouts and direct escalation)',
        'Maintaining v1 costs ~0.5 engineer (security patches, mappers, on-call, docs)',
      ],
      steps: [
        { label: 'Halvings needed', calc: '30% → 0.5% requires 30/0.5 = 60× reduction → log2(60) ≈ 5.9 halvings' },
        { label: 'Time', calc: '5.9 × 6 weeks ≈ 35 weeks ≈ 8 months' },
        { label: 'Cost of overlap', calc: '0.5 engineer × 8 months ≈ 4 engineer-months' },
        { label: 'Tail clients', calc: 'Assuming long-tail clients are small: 0.5% of traffic may still be ~50–100 of the 1,200 apps → brownouts + direct contact' },
      ],
      answer:
        'About 8 months from announcement to a sunset below 0.5% of traffic, costing roughly 4 engineer-months of v1 maintenance, plus a long tail of small integrations to chase with brownouts.',
      insight:
        'Majors are expensive mostly because of the overlap period. Additive evolution avoids that cost; when a major is unavoidable, measure usage per client from day one and start outreach immediately.',
      followUps: [
        {
          "q": "Outreach is weaker than planned: v1 traffic halves every 10 weeks instead of 6. What happens to the timeline and cost, and what do you change?",
          "a": "5.9 halvings × 10 weeks ≈ 59 weeks, about 14 months, costing ~7 engineer-months of v1 maintenance instead of 4. Attack the curve, not the threshold: find the 20 API keys that make up most of the remaining v1 traffic (usually a power law) and give them direct engineering help or an SDK upgrade. Start brownouts earlier to flush out passive clients, and make v1 cheaper to keep by turning it into a thin adapter over v2."
        },
        {
          "q": "At 8 months you're at 0.5%, but that's one enterprise customer worth 10% of revenue. Now what?",
          "a": "Traffic share isn't the right sunset metric; revenue and contractual risk are. Negotiate: give them a dedicated, time-boxed extension (6 months), ideally paid or tied to their renewal, with a named migration owner on each side. Isolate v1 so only their key can reach it (allow-list), which cuts the attack surface and maintenance. Offer to do part of the migration yourselves, since a few engineer-weeks are far cheaper than another 6 months of v1 for everyone."
        }
      ],
    },
    {
      id: 'api-evolution-boe-2',
      question:
        'Compare pipeline time and spurious-failure rate for (a) the current suite: 1,500 unit tests + 40 E2E tests, versus (b) a pyramid: 1,500 unit + 250 component (Testcontainers) + 80 contract + 8 E2E smoke tests.',
      assumptions: [
        'Unit: 5 ms each; component: 150 ms each after a one-off 8 s container start; contract: 100 ms each',
        'E2E: 60 s each, run 4 in parallel; each E2E test has a 2% flake rate',
        'Component and contract tests are deterministic (flake ≈ 0)',
      ],
      steps: [
        { label: 'Unit (both)', calc: '1,500 × 5 ms = 7.5 s' },
        { label: '(a) E2E time', calc: '40 × 60 s ÷ 4 = 600 s = 10 min' },
        { label: '(a) Spurious failure rate', calc: '1 − 0.98^40 ≈ 1 − 0.446 ≈ 55% of runs' },
        { label: '(b) Component + contract', calc: '8 s + 250 × 0.15 s + 80 × 0.1 s ≈ 8 + 37.5 + 8 ≈ 54 s' },
        { label: '(b) E2E smoke', calc: '8 × 60 s ÷ 4 = 120 s; spurious failures 1 − 0.98^8 ≈ 15%' },
      ],
      answer:
        '(a) takes ~10 minutes and fails spuriously ~55% of the time; (b) takes ~3 minutes, fails spuriously ~15% of the time (and only in the post-deploy smoke stage), with far more behaviour covered.',
      insight:
        'Flakiness compounds exponentially with E2E count. Moving confidence into deterministic component and contract tests makes the pipeline faster and trustworthy enough to gate deployments.',
      followUps: [
        {
          "q": "The team grows and the component suite reaches 2,000 tests at 150 ms each. Does the pyramid still give fast feedback?",
          "a": "2,000 × 0.15 s = 300 s, about 5 minutes serially, plus the 8 s container start. Run it sharded over 4–6 CI workers, each with its own DB, and it's back to about 1 minute. Add test impact analysis (run only the tests whose modules changed on PRs, the full suite on main) to cut it further. Watch for the 150 ms creeping up: the usual culprit is per-test fixture setup, so share read-only fixtures and use transaction rollback instead of truncation."
        },
        {
          "q": "Leadership asks why the 8 E2E smoke tests run after deploy rather than before. Defend it.",
          "a": "Pre-deploy E2E needs a full shared environment, which is slow and drifts from production, and at a 15% spurious failure rate it would block 1 in 7 deploys for nothing. Contract and component tests already gate compatibility deterministically. Post-deploy smoke tests run against the real production topology (real config, DNS, secrets) and catch environmental breakage that no pre-deploy environment can reproduce. Pair them with automated rollback on failure and a canary, so the blast radius is a few percent of traffic for a few minutes."
        }
      ],
    },
    {
      id: 'api-evolution-boe-3',
      question:
        'You strangle /search out of a monolith. It receives 3,000 RPS. Estimate the load of shadowing all traffic to the new service, and the sample size you need to trust the response-diff rate.',
      assumptions: [
        'New search service capacity planned for 1.5× production load',
        'Target: detect a mismatch rate of 0.1% with reasonable confidence',
        'Rule of thumb: to observe ~30 mismatches at rate p you need 30/p samples',
      ],
      steps: [
        { label: 'Shadow load at 100%', calc: '3,000 RPS extra on the new service (+ diff pipeline ingest of 6,000 responses/s)' },
        { label: 'Shadow load at 10%', calc: '300 RPS — enough for most validation' },
        { label: 'Samples needed', calc: '30 ÷ 0.001 = 30,000 compared responses' },
        { label: 'Time to collect at 10% shadow', calc: '30,000 ÷ 300 RPS = 100 s (collect across a full day to cover traffic patterns)' },
      ],
      answer:
        'Shadowing everything adds 3K RPS to the new service; 10% shadowing (300 RPS) collects the ~30K samples needed to measure a 0.1% mismatch rate in minutes, though you should sample across at least a day of traffic patterns.',
      insight:
        'Shadow traffic is a statistical tool: sample enough to measure the mismatch rate you care about across representative traffic, and budget the new service and diff pipeline for it before the canary.',
      followUps: [
        {
          "q": "The new search service is sized for 1.5× production. If you shadow 100% and then canary 50%, is it within capacity?",
          "a": "During the canary the new service handles 50% real traffic (1,500 RPS) plus shadow. If you keep shadowing everything, it also gets 3,000 shadow RPS, which totals 4,500 RPS = 1.5× production. It's exactly at the limit, with no headroom for a spike. Stop shadowing the traffic that's already served live, or drop shadow to 10% (300 RPS) during the canary, which gives 1,800 RPS = 0.6× capacity. Make shadow traffic lowest priority so it's shed first if the service is saturated."
        },
        {
          "q": "Your target is now 0.01% mismatch instead of 0.1%. How long do you need to collect, and does it change the shadow percentage?",
          "a": "Samples needed: 30 ÷ 0.0001 = 300,000 comparisons. At 10% shadow (300 RPS) that's 1,000 s, about 17 minutes. Still fine, so the percentage doesn't need to change. The real constraint is representativeness: rare query types (long-tail queries, unusual filters, specific locales) may appear once in 10K requests, so collect across at least a full daily and weekly cycle and stratify the diff report by query type so rare mismatches aren't averaged away."
        }
      ],
    },
  ],
  test: [
    {
      id: 'api-evolution-mcq-01',
      difficulty: 'hard',
      question: 'Which of these changes to a v1 REST API are breaking for existing clients? Select ALL that apply.',
      options: [
        'Adding an optional query parameter ?includeArchived=false',
        'Making the previously optional request field "phone" required',
        'Changing "createdAt" from an ISO-8601 string to a Unix timestamp number',
        'Adding a new response field "loyaltyTier"',
        'Reducing the maximum allowed length of "notes" from 2,000 to 500 characters',
      ],
      correct: [1, 2, 4],
      explanation:
        'A new required input rejects old clients\' requests, a type/format change breaks parsers, and tightening validation rejects previously valid requests. Optional parameters with the old default and new response fields are additive (assuming tolerant readers).',
      followUps: [
        {
          "q": "Product insists that `notes` must be capped at 500 characters for new data. How do you ship that without breaking existing clients?",
          "a": "Don't reject on input within the current major. Accept up to 2,000 as before, and enforce 500 at a different layer: truncate for display, or store the full text and return a `notesTruncated` flag. Publish the new limit as a documented deprecation and emit a `Warning` or deprecation header when a request exceeds 500, while counting such requests per client. Only reject longer values in the next major, or after usage metrics show no client still sends more than 500 characters."
        },
        {
          "q": "Is adding `?includeArchived=false` still non-breaking if the server default is `true`?",
          "a": "No. Compatibility is about behaviour, not just the schema. If old clients omit the parameter and the server now defaults to including archived records, their responses change: lists grow, counts change, and archived items appear in UIs that never expected them. A new optional parameter is only additive if its default reproduces the old behaviour exactly. Here that means `includeArchived` must default to `false`. Document defaults in the OpenAPI spec so a diff tool can catch a changed default."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-02',
      difficulty: 'expert',
      question: 'A team makes this change to a proto used by deployed clients. What happens?',
      code: {
        language: 'protobuf',
        code: `// before
message Payment {
  string id = 1;
  int64 amount_cents = 2;
  string currency = 3;
}
// after: "we don't use currency any more; reuse slot 3 for the merchant"
message Payment {
  string id = 1;
  int64 amount_cents = 2;
  string merchant_id = 3;
}`,
      },
      options: [
        'Old clients read merchant IDs as currency codes (and new readers read old data\'s currency as merchant_id) — silent data corruption',
        'Nothing — old clients ignore the renamed field',
        'Old clients fail to decode because the field name changed',
        'gRPC rejects the call with INVALID_ARGUMENT',
      ],
      correct: [0],
      explanation:
        'On the wire only the field number and wire type matter; both are string/length-delimited with number 3, so decoding succeeds but with the wrong meaning. Removed fields must be reserved and new fields must get new numbers. Names aren\'t on the binary wire (so there is no decode error), and gRPC doesn\'t validate semantics.',
      followUps: [
        {
          "q": "The change has been live for two days and Kafka topics now contain messages with merchant ids in field 3. How do you clean up?",
          "a": "Roll back the proto immediately: restore `currency = 3`, add `merchant_id = 4`, and redeploy producers. For the two days of bad data, find the affected offset range from deploy timestamps. Consumers that decoded currency from those messages must reprocess them with a decoder that knows field 3 held a merchant id in that window, keyed by producer version (stamp a schema version header on messages going forward). Then add `buf breaking` with the FILE or WIRE rules in CI so reusing a number fails the PR."
        },
        {
          "q": "How would you remove `currency` correctly if it's genuinely unused?",
          "a": "First prove it's unused: check that no consumer reads it, using code search across repos, consumer contracts, and field-level telemetry if you have it. Then delete the field and add `reserved 3; reserved \"currency\";` so the number and name can never be reused. Old producers that still send field 3 are harmless, because new readers treat it as unknown and skip it. Old readers that expected it see the default empty string, so confirm none rely on it before deleting."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-03',
      difficulty: 'hard',
      question:
        'You add REFUNDED to an order status enum in a JSON API. Which client code is most likely to break?',
      code: {
        language: 'typescript',
        code: `type Status = 'PLACED' | 'PAID' | 'SHIPPED';
function label(s: Status): string {
  switch (s) {
    case 'PLACED': return 'Placed';
    case 'PAID': return 'Paid';
    case 'SHIPPED': return 'Shipped';
    default: { const never: never = s; throw new Error('unknown status ' + never); }
  }
}`,
      },
      options: [
        'None — TypeScript types are erased at runtime, so the new value passes through',
        'Only clients written in languages with native enums',
        'Only clients that send the status in requests',
        'This client: at runtime the exhaustive default throws for the unknown value',
      ],
      correct: [3],
      explanation:
        'Types are erased, so "REFUNDED" arrives at runtime and falls into the default branch, which throws — the exhaustiveness check only helps at compile time. Tolerant readers map unknown values to a fallback. Enum additions can break any reader that assumes a closed set, regardless of language.',
      followUps: [
        {
          "q": "Rewrite this client so it survives future enum additions while still getting compile-time help.",
          "a": "Model the open set explicitly: `type Status = 'PLACED' | 'PAID' | 'SHIPPED' | (string & {})`, or parse at the boundary into `{ kind: 'known', value: KnownStatus } | { kind: 'unknown', raw: string }`. Keep the exhaustive `never` check over the known values, but route unknowns to a fallback such as `default: return 'Updated'` and log the raw value so you notice when the server adds one. The compiler still flags it when you add 'REFUNDED' to the known list but forget a case."
        },
        {
          "q": "Thousands of installed mobile apps have this exact switch. You can't update them. How do you roll out REFUNDED?",
          "a": "Gate it by client capability: only send `REFUNDED` to clients that declare support (an `Api-Features` header or app version ≥ X). Older clients receive a mapped value. REFUNDED probably maps to 'PAID' or a status with a generic label, decided with product so it isn't misleading. Add a new field such as `statusV2` that carries the full value for updated clients. Track how many requests per app version still get the mapped value, and remove the mapping when those versions fall below your support floor."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-04',
      difficulty: 'medium',
      question:
        'Under semantic versioning applied to APIs, which statement matches the book\'s guidance?',
      options: [
        'Every deployment increments the major version exposed in the URL',
        'Patch versions may remove deprecated fields',
        'A minor version is backward compatible and consumers receive it without making any change; a major requires an active decision to upgrade',
        'Consumers must pin to exact MAJOR.MINOR.PATCH versions of a running service',
      ],
      correct: [2],
      explanation:
        'Major = incompatible, consumer opts in (with migration guidance); minor = compatible, applied without consumer change; patch = bug fixes without new functionality. Removing fields is breaking (major), and consumers of a running service bind to the major only.',
      followUps: [
        {
          "q": "You're on v1.14 and need one breaking change for a single endpoint. Do you cut v2 of the whole API?",
          "a": "Usually not. A whole-API major forces every consumer to migrate for one endpoint. Prefer adding a new resource or operation alongside the old one (for example `/v1/invoices-v2` or a new media type for that resource) and deprecating the old one with a sunset date. That keeps the rest of v1 untouched. Reserve a full v2 for when many breaking changes have accumulated or the core model changes, and batch them so consumers migrate once rather than every quarter."
        },
        {
          "q": "How do consumers actually discover which minor version they're getting from a running service, and why does it matter?",
          "a": "Expose it: return an `API-Version: 1.14.2` response header and publish a changelog per minor. Consumers bind only to the major, but when a minor introduces a behavioural regression, support needs to correlate 'started failing at 14:05' with 'minor 1.14 deployed at 14:03'. The provider should log the version served with every request. Clients can record the header in their own logs, which makes cross-team incident timelines much faster to build."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-05',
      difficulty: 'expert',
      question: 'Which statements about this rename rollout are true? Select ALL that apply.',
      code: {
        language: 'text',
        code: `Deploy 1 (Mon): API returns both givenName and firstName; accepts either.
Deploy 2 (Tue): web + iOS apps switch to firstName.
Deploy 3 (Wed): API stops returning givenName.`,
      },
      options: [
        'Deploy 3 can break iOS users who haven\'t updated the app from the store yet',
        'Deploy 3 should wait for usage evidence (per-client metrics / pacts) showing no consumer still reads givenName',
        'Expand and contract happening within the same week is safe because both steps are separate deployments',
        'Partners who integrate directly against the API may still depend on givenName',
      ],
      correct: [0, 1, 3],
      explanation:
        'Mobile app versions live in the wild for months, and third parties migrate on their own schedule, so contracting after two days breaks them. Separate deployments are necessary but not sufficient — the contract step needs evidence that usage is zero (metrics, contract tests) or a sunset date that has passed.',
      followUps: [
        {
          "q": "What concrete evidence would you require before running Deploy 3?",
          "a": "Per-client field usage telemetry. Responses can't tell you which fields a client reads, so measure request-side use (clients still sending `givenName`) and use proxies for reads: User-Agent and app version distribution (iOS builds older than the firstName release still active), API keys of partners not yet migrated, and consumer pacts in the broker that still reference `givenName`. The rule: no deployed pact references it, the share of old app versions is below the support floor (for example under 1%), and the partner sunset date has passed."
        },
        {
          "q": "A partner can't migrate for 9 months, but you want to drop givenName for everyone else now. Options?",
          "a": "Make the old field opt-in per client instead of global. Keep `givenName` in a response transformer that runs only for API keys on an allow-list, or for clients that send a legacy version header. Everyone else gets the contracted shape. That keeps the core code clean, because the transformer is a small adapter at the edge, and the cost is isolated to that one partner. Put an expiry date on the allow-list entry and charge or escalate if it's extended."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-06',
      difficulty: 'hard',
      question:
        'A header-versioned API (Api-Version: 1 or 2) sits behind a CDN. Some v1 clients start receiving v2 responses. What is the most likely cause?',
      options: [
        'Responses lack Vary: Api-Version, so the CDN caches one representation per URL regardless of the version header',
        'The CDN does not support HTTPS',
        'The client libraries lowercase header names',
        'The origin should use 301 redirects between versions',
      ],
      correct: [0],
      explanation:
        'Caches key on URL by default; if the representation depends on a request header, the response must declare Vary on it (or the header must be added to the cache key). Header names are case-insensitive in HTTP, HTTPS is unrelated, and redirects don\'t solve cache-key collisions.',
      followUps: [
        {
          "q": "You add `Vary: Api-Version` and the CDN hit rate drops sharply. Why, and what do you do?",
          "a": "Many CDNs handle `Vary` poorly. Some refuse to cache any response with Vary on a non-standard header, and others key on the raw header value, so `1`, ` 1` and a missing header become separate entries. Normalise at the edge: an edge rule maps a missing or odd value to a canonical version and adds it to the cache key explicitly, instead of relying on Vary. Alternatively, move the version into the URL for cacheable endpoints, since URL-keyed caching is the most predictable option."
        },
        {
          "q": "How would you have caught this before users did?",
          "a": "Add a synthetic check that requests the same URL alternately with `Api-Version: 1` and `2` through the CDN (not the origin) and asserts that each response matches the requested version, using a version field or header in the body. Also run a cache-key lint in CI that fails when a handler reads a request header that affects the representation without declaring it in Vary. Make the origin echo `API-Version` in responses so mismatches show up in CDN logs."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-07',
      difficulty: 'expert',
      question:
        'openapi-diff reports "API changes are backward compatible" for a PR, yet a consumer breaks after deploy. Which changes could explain it? Select ALL that apply.',
      options: [
        'The default sort order of GET /orders changed from newest-first to oldest-first',
        'A response field that was always populated is now null in some cases (schema already allowed null)',
        'A required response property was removed from the schema',
        'An error that used to be 404 is now returned as 200 with an empty list',
      ],
      correct: [0, 1, 3],
      explanation:
        'Sort order, runtime nullability within an already-permissive schema, and status-code semantics not captured in the spec are behavioural changes invisible to a schema diff. Removing a required response property is exactly what diff tools detect (the book\'s givenName example), so that one would have been flagged.',
      followUps: [
        {
          "q": "How do you catch behavioural changes like the sort-order flip, given that a schema diff can't?",
          "a": "Combine three things. Consumer contracts: if checkout's pact asserts that the first item is newest for a given provider state, the flip fails verification. Golden or approval tests on the provider: record responses for fixed fixtures and review diffs in the PR. Shadow traffic or response diffing during rollout, which compares old and new builds on real requests and flags ordering differences. Also document defaults such as sort order in the spec as `x-default-sort`, so reviewers see the change."
        },
        {
          "q": "The field that's now sometimes null: the schema already allowed null, so is the consumer wrong?",
          "a": "Technically the contract allowed it, but in practice the observed behaviour was the contract (Hyrum's law). Clients built against real responses assumed it was always present. The provider should treat 'never null in practice → sometimes null' as a breaking behavioural change: announce it, use a new field, or make it opt-in. Going forward, tighten schemas to match reality (`nullable: false` where it's always populated) so the diff tool can enforce it. Encourage consumers to be tolerant readers of documented nulls."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-08',
      difficulty: 'hard',
      question: 'What is the main weakness of this consumer Pact interaction?',
      code: {
        language: 'typescript',
        code: `provider.uponReceiving('get order')
  .withRequest({ method: 'GET', path: '/v1/orders/ord_1' })
  .willRespondWith({
    status: 200,
    body: {
      id: 'ord_1', status: 'PLACED', totalCents: 1999, currency: 'EUR',
      createdAt: '2026-01-05T10:00:00Z', updatedAt: '2026-01-05T10:00:00Z',
      customer: { id: 'cus_9', email: 'a@b.com', tier: 'gold' }, items: [/* 12 items */],
    },
  });`,
      },
      options: [
        'Pact cannot express nested objects',
        'Contract tests must not include response bodies',
        'It is missing a provider state, so the verification will be skipped',
        'It is over-specified: exact literal values and fields the consumer doesn\'t use make the contract brittle and block harmless provider changes',
      ],
      correct: [3],
      explanation:
        'Without matchers, the provider must return these exact values, and including unused fields forbids the provider from changing them even though the consumer doesn\'t care. Use like/integer/eachLike and only fields the consumer reads. Nested objects are fine; a missing provider state makes data setup harder but doesn\'t skip verification.',
      followUps: [
        {
          "q": "Rewrite the interaction properly. checkout-web only displays id, status and totalCents.",
          "a": "Use a provider state and matchers for only the fields that are read: `given('order ord_1 exists').withRequest({method:'GET', path:'/v1/orders/ord_1'}).willRespondWith({status:200, body:{ id: like('ord_1'), status: regex('PLACED|PAID|SHIPPED','PLACED'), totalCents: integer(1999) }})`. Drop customer, items and timestamps. The provider may change them freely because checkout doesn't read them. The regex is deliberate: it records which status values this consumer understands, so adding a new value shows up as a conversation, not a silent break."
        },
        {
          "q": "The provider state 'order ord_1 exists' needs data in four tables. How does the provider make verification fast and reliable?",
          "a": "Implement a state handler in the provider test that seeds exactly what's needed, ideally through domain factories or repositories rather than raw SQL, against a Testcontainers Postgres with real migrations. Wrap each interaction in a transaction that rolls back, or truncate between states, to keep tests isolated. Stub only external dependencies the provider calls (payment, inventory) at the HTTP boundary. Verification should take seconds, so it can run on every provider PR and from broker webhooks."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-09',
      difficulty: 'medium',
      question:
        'Your public API is consumed by thousands of unknown third-party developers. Which contract approach fits best, per Mastering API Architecture?',
      options: [
        'Consumer-driven contracts: ask every third party to submit pacts',
        'Producer contracts: the provider defines and publishes its contracts, backed by versioning and breaking-change detection',
        'No contracts — rely on the OpenAPI spec being accurate',
        'E2E tests against each customer\'s integration',
      ],
      correct: [1],
      explanation:
        'Producer contracts suit APIs with many external consumers who can\'t each negotiate changes (the book cites Microsoft Graph); CDC works best when consumers and producers are in the same organisation. Relying solely on a spec gives no behavioural verification, and testing each customer\'s integration doesn\'t scale.',
      followUps: [
        {
          "q": "You use producer contracts for the public API. How do you still learn which fields third parties rely on before removing one?",
          "a": "Use telemetry instead of pacts. Log per API key which endpoints, parameters and request fields are used. For response fields, offer sparse fieldsets (`?fields=`), so explicit field lists tell you exactly what each client reads, and run brownout experiments: omit the field for 1% of requests per key for a short window and watch error rates. Combine that with the deprecation process (Deprecation and Sunset headers, changelog, emails to active key owners) and a long overlap measured in months."
        },
        {
          "q": "Your SDKs are what most third parties actually use. How does that change your contract strategy?",
          "a": "The SDK becomes your consumer, and you own it, so consumer-driven contracts work again between SDK and API: SDK tests generate pacts or recorded expectations that the API verifies in CI. You can also absorb changes in the SDK (map new shapes to old types) and steer users via deprecation warnings at compile time. The catch is old SDK versions in the wild. Track SDK version via User-Agent and keep the API compatible with every supported SDK release."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-10',
      difficulty: 'hard',
      question:
        'The orders-api provider passes verification of checkout-web\'s pact from checkout\'s main branch, but production checkout (two versions behind main) breaks after an orders-api deploy. What was missing?',
      options: [
        'The provider should have verified pacts from all branches of all consumers',
        'Pact cannot protect against this; only E2E tests can',
        'The consumer should have used exact values instead of matchers',
        'Verification against the consumer versions actually deployed (deployedOrReleased selectors) and a can-i-deploy check against the production environment',
      ],
      correct: [3],
      explanation:
        'Compatibility must hold with what is deployed, not just main; consumer version selectors for deployed versions plus can-i-deploy (fed by record-deployment) answer exactly that. Verifying every branch is noisy and still misses the deployment matrix; exact values make contracts more brittle, not safer.',
      followUps: [
        {
          "q": "orders-api wants to deploy a change that main checkout supports but the production checkout version doesn't. can-i-deploy says no. What now?",
          "a": "Deploy the consumer first: ship the checkout version that's compatible with the new provider behaviour, run `record-deployment`, and then can-i-deploy for orders-api turns green. If the consumer can't ship soon, the provider must make the change backward compatible (expand: support both behaviours) and deploy that. Never bypass the gate with a flag. The matrix is exactly telling you production would break. This ordering is why pact + can-i-deploy replaces coordinated release trains."
        },
        {
          "q": "checkout runs three versions in production at once (blue/green plus a canary). Does the setup still work?",
          "a": "Yes, if every deployed version is recorded. Use `record-release` or record a deployment per instance or environment, and use the `deployedOrReleased` selector so the provider verifies against all three versions. can-i-deploy for orders-api then checks compatibility with each of them. When the old blue version is torn down, run `record-support-ended` (or the next deployment supersedes it) so the provider is no longer constrained by a version nobody runs."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-11',
      difficulty: 'expert',
      question: 'This integration test passes locally but production queries fail. Why is this setup the likely culprit?',
      code: {
        language: 'typescript',
        code: `// test setup
const ds = new DataSource({ type: 'sqlite', database: ':memory:', synchronize: true, entities });
// production: Postgres 16 with migrations; repository uses
//   SELECT ... WHERE tags @> $1::jsonb ... FOR UPDATE SKIP LOCKED`,
      },
      options: [
        'SQLite in-memory with synchronize bypasses real migrations and doesn\'t support Postgres-specific SQL (jsonb operators, SKIP LOCKED), so the test exercises different code paths than production',
        'SQLite is too slow for tests',
        'In-memory databases are not isolated between tests',
        'TypeORM does not support SQLite',
      ],
      correct: [0],
      explanation:
        'A substitute database differs in dialect, locking, JSON support and schema (synchronize ignores your migrations), so tests pass against behaviour production never has. Testcontainers with the production Postgres version and real migrations fixes this. Speed and isolation aren\'t the main problem, and TypeORM supports SQLite.',
      followUps: [
        {
          "q": "You switch to Testcontainers Postgres. The suite goes from 40 s to 6 min. How do you get speed back without going back to SQLite?",
          "a": "Start the container once per test run (global setup), not per file, and run migrations once. Isolate tests with per-test transactions rolled back at the end, or create a template database once and clone it per worker with `CREATE DATABASE test_n TEMPLATE base`, which is fast. Run Jest workers in parallel, each with its own DB. Use container reuse locally (`withReuse()`) and keep heavy fixtures small. A typical result is about 1 minute for a few hundred DB tests."
        },
        {
          "q": "How do you make sure tests run the same migrations production does?",
          "a": "Remove `synchronize: true` everywhere outside throwaway prototypes, and have test setup run the exact migration command used in deploys (`typeorm migration:run`) against the container. Pin the Postgres image to the production major and minor version (for example `postgres:16.3`). Add a CI check that generates a migration from the entities and fails if it's non-empty, which catches entity changes without a migration. Optionally restore a sanitised production schema dump and run pending migrations on it to catch drift."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-12',
      difficulty: 'hard',
      question:
        'In a strangler-fig migration, which step order is safest for moving GET /search from the monolith to a new service?',
      options: [
        'Switch DNS directly to the new service; roll back if errors rise',
        'Deploy the new service with an improved response format, then update clients',
        'Gateway in front of the monolith → shadow traffic to the new service with response diffing → canary a small percentage → ramp to 100% → retire monolith code',
        'Dual-write search index updates from the client apps to both systems',
      ],
      correct: [2],
      explanation:
        'A facade first makes routing reversible; shadowing proves behavioural equivalence without user impact; canarying limits blast radius; only then retire old code. A DNS flip is all-or-nothing, changing the contract during migration breaks clients, and client-side dual writes create inconsistency.',
      followUps: [
        {
          "q": "Shadow traffic shows a 2% mismatch rate, mostly in result ordering. Do you block the canary?",
          "a": "Classify before deciding. Diff on normalised responses: for search, ties in relevance score can legitimately reorder, so compare the result sets and the order of top-k only when scores differ. Bucket the remaining mismatches by type (missing results, extra results, different fields) and sample examples. Block only on real defects, such as missing documents due to indexing lag or a different analyser. Agree the acceptable residual with the consumers and document it before ramping."
        },
        {
          "q": "GET /search is easy because it's read-only. How would the strangler approach change for POST /orders?",
          "a": "You can't shadow writes naively, because that would create duplicate orders or charges. Options: shadow in 'dry-run' mode, where the new service validates and computes the response but doesn't persist or call side-effecting dependencies; or route writes to one system while the other syncs via CDC, so both have the data, and switch the authority at cutover. Canary by tenant rather than by request, so one customer's orders don't split across systems, and keep a reverse sync for rollback."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-13',
      difficulty: 'medium',
      question:
        'What should an API return for requests to an endpoint after its announced Sunset date has passed?',
      options: [
        '404 Not Found with an empty body',
        '500 Internal Server Error',
        '301 redirect to the v2 endpoint regardless of request shape',
        '410 Gone with a problem body linking to the migration guide',
      ],
      correct: [3],
      explanation:
        '410 communicates intentional, permanent removal, and a problem+json body with the migration link helps stragglers. 404 is ambiguous (typo vs removal), a redirect to an endpoint with a different contract causes confusing failures (and non-GET methods may be changed by clients), and 500 misreports a deliberate state as a server fault.',
      followUps: [
        {
          "q": "After you return 410, a large customer's nightly job fails and they escalate. How should the process have prevented this surprise?",
          "a": "Brownouts before the sunset: return 410 for scheduled windows that grow (1 h, then 1 day, then 1 week) in the months before, announced in advance. That flushes out forgotten jobs while there's still time. Also run usage-based outreach: any API key that hit the endpoint in the last 30 days gets direct contact, not just a changelog. For the escalation now, a time-boxed exception (re-enable for that key for 2 weeks) is reasonable, but it should be tracked and expire."
        },
        {
          "q": "Should the 410 response be cacheable at the CDN?",
          "a": "Yes, with care. A 410 is permanent by definition, and caching it protects the origin from stragglers. HTTP allows 410 to be cached heuristically. Set an explicit `Cache-Control: public, max-age=3600` rather than relying on defaults, so if you have to re-enable the endpoint temporarily (as in an escalation) the cached 410 clears within an hour. Make sure the cache key doesn't collapse different endpoints, and that the problem body with the migration link is served from cache too."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-14',
      difficulty: 'expert',
      question:
        'A proto field is renamed from given_name to first_name, keeping field number 2. Which consumers can break? Select ALL that apply.',
      options: [
        'Native gRPC clients using binary protobuf generated from the old .proto',
        'REST clients behind grpc-gateway / JSON transcoding that read "givenName" from JSON',
        'Services that store messages as protobuf JSON (e.g. in a document DB or logs) and parse them later',
        'Code in the consumer\'s repo that refers to the generated field name after regenerating stubs',
      ],
      correct: [1, 2, 3],
      explanation:
        'The binary wire format uses only the number, so old binary clients keep working. JSON mapping uses field names (lowerCamelCase), so transcoded REST clients and stored JSON break, and regenerated code breaks at compile time (source compatibility). buf\'s WIRE_JSON rules exist to catch this.',
      followUps: [
        {
          "q": "You need the rename anyway for readability. How do you do it without breaking the JSON consumers?",
          "a": "Don't rename. Add `first_name = 5` as a new field, populate both during migration, and mark `given_name` `[deprecated = true]`. Contract later, once JSON consumers have moved. If only the generated code name bothers you, protobuf has `json_name`: you could rename to `first_name` with `[json_name = \"givenName\"]` so JSON stays stable, but that breaks source compatibility for the Go and TS code generated from it. Run `buf breaking` with WIRE_JSON to confirm whichever option you choose."
        },
        {
          "q": "Which buf breaking rule category would you pick for this org, and why?",
          "a": "If any service uses JSON transcoding, grpc-gateway, or stores protobuf JSON (logs, document DBs), use WIRE_JSON. It catches field-name and json_name changes as well as number and type changes. Use plain WIRE only if all consumers are binary-only. FILE (the default) is strictest: it also protects generated-code source compatibility (package and file moves), which suits a monorepo where everyone regenerates from the same protos. Many orgs run FILE on shared protos and WIRE_JSON on external-facing ones."
        }
      ],
    },
    {
      id: 'api-evolution-mcq-15',
      difficulty: 'hard',
      question:
        'Your nightly E2E suite has 30 tests with a 3% independent flake rate each. Roughly how often does a run fail even though nothing is broken?',
      options: ['About 3%', 'About 30%', 'About 60%', 'About 90%'],
      correct: [2],
      explanation:
        'P(all pass) = 0.97^30 ≈ 0.40, so ~60% of runs fail spuriously — which is why teams learn to ignore E2E failures. Treating the flake rate as the suite\'s failure rate (3%) or summing naively (90%) are common mistakes. The fix is fewer E2E tests, with confidence moved into deterministic component and contract tests.',
      followUps: [
        {
          "q": "You add automatic retries (up to 2 retries per failed test). What's the new spurious failure rate, and what's the hidden cost?",
          "a": "A test now fails spuriously only if all 3 attempts flake: 0.03³ = 0.000027. Across 30 tests, 1 − (1 − 0.000027)^30 ≈ 0.08%. That's near zero. The hidden cost: retries also mask real intermittent bugs (race conditions, timeouts under load) that a customer would hit, and they add runtime. Track per-test flake rates from the retry data, quarantine any test above about 1%, and treat 'passed on retry' as a signal to investigate rather than a success."
        },
        {
          "q": "How do you find which of the 30 tests is responsible for most of the flakiness?",
          "a": "Record every test result with run id, attempt, duration and failure message in a results store (JUnit XML to a dashboard, or a CI flake tracker). Compute a per-test flake rate as failures that pass on retry or pass on the same commit elsewhere. Usually 3–4 tests account for most of it. Inspect their failure messages for patterns: timeouts waiting for async consumers, shared test data, ordering assumptions. Fix or quarantine with an owner and a deadline."
        }
      ],
    },
  ],
};

export default topic;
