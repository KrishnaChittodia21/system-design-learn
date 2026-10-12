import type { Topic } from '../../types';

const topic: Topic = {
  id: 'api-design',
  phase: 'apis-security',
  order: 1,
  title: 'API Design: REST, GraphQL & gRPC',
  subtitle:
    'Resource modeling, HTTP semantics, problem+json errors, cursor pagination, idempotency keys, ETags, bulk operations, GraphQL (DataLoader, cost limits, persisted queries), gRPC (protobuf, deadlines, streaming) and how to choose between them.',
  estimatedMinutes: 100,
  sources: [
    'Mastering API Architecture (Gough, Bryant, Auburn) — Ch 1 Design, Build, and Specify APIs',
    'Microsoft REST API Guidelines',
    'RFC 9110 HTTP Semantics; RFC 9457 Problem Details for HTTP APIs',
    'Stripe API — Idempotent requests',
    'GraphQL Cursor Connections Specification; DataLoader',
    'gRPC documentation — Deadlines, Streaming',
  ],
  tags: ['rest', 'graphql', 'grpc', 'pagination', 'idempotency', 'etag', 'openapi', 'problem-json', 'http-semantics', 'bff'],
  cheatSheet: [
    'Safe methods (GET, HEAD, OPTIONS) don\'t change state; idempotent methods (safe ones + PUT, DELETE) can be repeated with the same effect. POST and PATCH are neither by default → use Idempotency-Key.',
    'Status codes carry semantics clients code against: 201 + Location for creates, 202 for async, 204 no body, 409 state conflict, 412 failed precondition, 422 semantic validation, 429 rate limit, 503 overload.',
    'Errors: one consistent format — RFC 9457 application/problem+json (type, title, status, detail, instance + extensions); never leak stack traces.',
    'Wrap collections in an object ({ value: [...], nextLink }) from day one — converting a bare array later is a breaking change (Mastering API Architecture, Ch 1).',
    'Offset pagination is O(offset) per page and drifts under inserts; keyset/cursor (WHERE (created_at, id) < (:c, :id) ORDER BY … LIMIT n) is O(page) with a matching index.',
    'Idempotency keys: client-generated UUID per logical operation; server stores key → (request hash, status, response) atomically; same key + different body → 422; in-flight duplicate → 409.',
    'ETags: If-None-Match → 304 saves bandwidth; If-Match → 412 prevents lost updates (optimistic concurrency); 428 to require preconditions.',
    'GraphQL: batch per-request with DataLoader (N+1), limit depth/cost, use persisted (trusted) queries for security and GET/CDN caching; errors live in the response body with 200.',
    'gRPC: protobuf over HTTP/2 (multiplexed, binary), deadlines propagate via grpc-timeout, four call types (unary, server/client/bidi streaming); needs L7 load balancing because connections are long-lived.',
    'Choose by exchange: north-south/public → REST + OpenAPI; high-traffic east-west → gRPC; UI aggregation across many services → GraphQL or a BFF. Record the decision as an ADR.',
  ],
  sections: [
    {
      heading: '1. Resource modeling and the Richardson Maturity Model',
      body: `**Intuition:** a good REST API reads like a well-organised filing cabinet: drawers are collections (\`/orders\`), folders are resources (\`/orders/123\`), and you use the same few verbs everywhere instead of inventing new ones.

**Modeling rules that hold up in interviews**
- **Nouns, plural collections**: \`/customers\`, \`/customers/{id}\`, \`/customers/{id}/addresses\`. Keep nesting ≤ 2 levels; beyond that, link by ID (\`/addresses?customerId=\`).
- **Stable, opaque IDs** (UUID/ULID/prefixed IDs like \`ord_…\`), not emails or other **PII in URLs** — paths and query strings end up in logs, caches and browser history (Microsoft REST guidelines, cited in Mastering API Architecture).
- **Model state transitions as resources or sub-resources** when they're not simple field updates: \`POST /orders/{id}/cancellation\` or \`POST /payments/{id}/refunds\` rather than \`POST /cancelOrder\`.
- **Consistent naming** from a shared domain dictionary; a "tiny" rename (\`givenName\` → \`firstName\`) is a breaking change.
- **Design from the consumer's perspective** and hide the storage model — the API should survive a database redesign.

**Richardson Maturity Model**

| Level | What it means | Example |
|---|---|---|
| 0 — The swamp of POX | One endpoint, one verb, action in the body | \`POST /api\` with \`{"action":"getOrder"}\` (SOAP-style, JSON-RPC) |
| 1 — Resources | Distinct URIs per resource, but verbs ignored | \`POST /orders/123/get\` |
| 2 — HTTP verbs | Correct methods + status codes | \`GET /orders/123\` → 200, \`POST /orders\` → 201 |
| 3 — Hypermedia (HATEOAS) | Responses include links to next actions | \`"_links": {"cancel": {"href": "/orders/123/cancellation"}}\` |

Most successful public APIs (Stripe, GitHub) sit at **Level 2** with a sprinkle of links (pagination \`next\` links). Level 3 helps discoverability and evolvability but clients rarely drive behaviour from links. The book's advice: when choosing between REST and RPC, consider the maturity level you need and the **coupling** between producer and consumer.`,
      diagram: `  Level 3  Hypermedia controls     GET /orders/1 -> { ..., _links: { cancel } }
     ^
  Level 2  HTTP verbs + status     GET /orders/1  200 | POST /orders 201
     ^
  Level 1  Resources               POST /orders/1   (verb ignored)
     ^
  Level 0  Single endpoint (RPC)   POST /api { action: "getOrder", id: 1 }`,
      keyPoints: [
        'Plural nouns, shallow nesting, opaque IDs, no PII in URLs.',
        'State transitions as sub-resources, not verbs in paths.',
        'Level 2 is the pragmatic target; add links where they help (pagination).',
      ],
      source: 'Mastering API Architecture — Ch 1 (REST by example, Richardson Maturity Model)',
    },
    {
      heading: '2. HTTP semantics: methods, idempotency and status codes',
      body: `**Intuition:** HTTP methods and status codes are a contract that every proxy, cache, SDK and retry library already understands. Use them correctly and you get caching, retries and tooling for free; misuse them and infrastructure will do the wrong thing on your behalf.

| Method | Safe | Idempotent | Typical use | Notes |
|---|---|---|---|---|
| GET | ✓ | ✓ | Read | Cacheable; never mutate on GET (crawlers/prefetchers will call it) |
| HEAD | ✓ | ✓ | Metadata | Same headers as GET, no body |
| PUT | ✗ | ✓ | Replace/create at known URI | Sending it twice leaves the same state |
| DELETE | ✗ | ✓ | Remove | Second call may return 404, but the *state* is the same |
| POST | ✗ | ✗ | Create in collection, commands | Make retry-safe with an Idempotency-Key |
| PATCH | ✗ | ✗ (can be made so) | Partial update | JSON Merge Patch (RFC 7396) or JSON Patch (RFC 6902); an "increment" patch is not idempotent |

**Status codes worth being precise about**

| Code | When |
|---|---|
| 200 / 201 + \`Location\` / 204 | OK with body / created / OK without body |
| 202 Accepted | Work queued; return a status resource (\`Location: /jobs/abc\`) |
| 304 Not Modified | Conditional GET matched the ETag |
| 400 / 422 | Malformed syntax / well-formed but semantically invalid (validation) |
| 401 / 403 | Not authenticated / authenticated but not allowed |
| 404 / 410 | Not found / gone permanently |
| 409 Conflict | State conflict (duplicate, version conflict, in-flight idempotent request) |
| 412 / 428 | Precondition (If-Match) failed / precondition required |
| 429 | Client over its rate limit (+ Retry-After) |
| 500 / 502 / 503 / 504 | Server bug / bad upstream / overloaded or down (+ Retry-After) / upstream timeout |

**Why it matters for reliability:** retry libraries retry 502/503/504 and connection errors, not 4xx. Returning 500 for validation errors causes pointless retries; returning 200 with an error body defeats monitoring and caches. The book's question applies: *in a payment system, does a 500 mean the payment went through or not?* — define and document the semantics, and give clients idempotency so they can safely find out.`,
      keyPoints: [
        'Safe ⊂ idempotent: GET/HEAD/OPTIONS safe; PUT/DELETE idempotent; POST/PATCH neither.',
        'Status codes drive client and infrastructure behaviour (retries, caching, alerts).',
        '202 + status resource for async work; 409/412/422/429 have distinct meanings.',
      ],
      source: 'RFC 9110 HTTP Semantics; Mastering API Architecture — Ch 1 (Error Handling)',
    },
    {
      heading: '3. Error model: RFC 9457 problem details',
      body: `**Intuition:** clients should be able to write *one* piece of error-handling code for your whole API (the Microsoft guideline the book quotes: "developers SHOULD be able to write one piece of code that handles errors consistently").

**RFC 9457** (July 2023, obsoletes RFC 7807) defines \`application/problem+json\`:

- \`type\` — URI identifying the problem type (documentation link); the stable, machine-readable discriminator.
- \`title\` — short human summary of the type (doesn't change between occurrences).
- \`status\` — the HTTP status code (advisory copy).
- \`detail\` — human explanation of *this* occurrence.
- \`instance\` — URI identifying this occurrence (often the request path or an error ID).
- **Extensions** — any extra members: \`errors\` (field-level validation list), \`traceId\`, \`retryAfter\`, \`balance\`.

**Rules**
- Clients branch on \`type\` (and status), never on parsing \`detail\` strings.
- **No stack traces, SQL, or internal hostnames** in responses to external consumers — the book highlights keeping a detailed "inner error" for internal debugging and stripping it at the edge.
- Include a **trace/correlation ID** so support can find the logs.
- Validation errors: return *all* field errors at once (JSON Pointer to the field), not just the first.
- Be deliberate about information disclosure for security flows (login: same error for wrong user and wrong password).`,
      code: [
        {
          language: 'json',
          title: 'Validation failure as problem+json (422)',
          code: `{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Your request parameters didn't validate.",
  "status": 422,
  "detail": "2 fields are invalid.",
  "instance": "/v1/orders",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    { "pointer": "/items/0/quantity", "detail": "must be >= 1" },
    { "pointer": "/shippingAddress/postalCode", "detail": "invalid format for country DE" }
  ]
}`,
        },
        {
          language: 'typescript',
          title: 'NestJS exception filter emitting problem+json without leaking internals',
          code: `import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    const traceId = (req.headers['traceparent'] as string | undefined)?.split('-')[1];

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {
      type: 'https://api.example.com/problems/internal', title: 'Internal error',
    };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'object' ? { type: 'about:blank', ...(r as object) } : { type: 'about:blank', title: r };
    } else {
      // Full details stay in logs, never in the response
      this.log.error({ traceId, err: exception });
    }
    res.status(status).type('application/problem+json').json({
      ...body, status, instance: req.originalUrl, traceId,
    });
  }
}`,
        },
      ],
      keyPoints: [
        'One error format everywhere: problem+json with a stable type URI.',
        'Field-level errors in an extension; trace ID for support.',
        'Strip internals at the boundary; log them instead.',
      ],
      source: 'RFC 9457; Mastering API Architecture — Ch 1 (Error Handling)',
    },
    {
      heading: '4. Collections: pagination (offset vs cursor), filtering and sorting',
      body: `**Intuition:** offset pagination is "skip the first 10,000 pages of the book, then read one"; the database really does read (and discard) those pages. A cursor is a bookmark: "continue after this exact line".

**Wrap collections in an object.** Mastering API Architecture's example: returning a bare JSON array from \`GET /attendees\` seems fine, but adding pagination later (\`@nextLink\`) forces a switch to an object — a breaking change. Start with \`{ "value": [...], "nextLink": "…" }\` (or \`data\`/\`next_cursor\`).

**Offset/limit** — \`?offset=10000&limit=50\` → \`OFFSET 10000 LIMIT 50\`
- ✓ Simple, random page access ("jump to page 7"), easy total counts.
- ✗ Cost grows linearly with offset (the DB scans offset + limit rows); **inconsistent under writes** — an insert at the head shifts everything, so users see duplicates or miss items between pages.

**Keyset / cursor** — \`?after=<cursor>&limit=50\`
- Query: \`WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 51\` with an index on \`(created_at DESC, id DESC)\`. The \`id\` tiebreaker makes the order total (timestamps collide).
- ✓ O(limit) per page regardless of depth, stable under inserts.
- ✗ No random page jumps; cursor tied to the sort order; changing sort = new cursor.
- Make cursors **opaque** (base64url of the last row's sort keys, optionally signed/encrypted) so you can change the implementation without breaking clients. Fetch \`limit + 1\` rows to know whether there's a next page without a count query.

**Totals:** \`COUNT(*)\` over millions of rows is expensive; offer \`hasMore\`, an approximate count (\`pg_class.reltuples\`/estimates), or \`?includeTotal=true\` as an opt-in.

**Filtering & sorting**
- The book cites the OData \`$filter\` standard (\`?$filter=displayName eq 'Jim'\`); simpler APIs use \`?status=open&createdAfter=…\`.
- **Allow-list** filterable and sortable fields and make sure each is **index-backed**; arbitrary filters/sorts on large tables are a denial-of-service vector.
- Cap \`limit\` (e.g. default 50, max 200) server-side.
- Heavy ad-hoc querying across services is where GraphQL or a search index fits better.`,
      code: [
        {
          language: 'typescript',
          title: 'Keyset pagination with opaque cursors (pg)',
          code: `import { Pool } from 'pg';
const db = new Pool();

type Cursor = { t: string; id: string }; // last row's sort keys
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const decode = (s: string): Cursor => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export async function listOrders(customerId: string, after?: string, limitParam = 50) {
  const limit = Math.min(Math.max(limitParam, 1), 200);           // server-side cap
  const c = after ? decode(after) : null;

  // Index: CREATE INDEX ON orders (customer_id, created_at DESC, id DESC);
  const { rows } = await db.query(
    'SELECT id, status, total_cents, created_at FROM orders ' +
    'WHERE customer_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3)) ' +
    'ORDER BY created_at DESC, id DESC LIMIT $4',
    [customerId, c?.t ?? null, c?.id ?? null, limit + 1],            // +1 to detect next page
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    value: page,
    nextCursor: rows.length > limit && last
      ? encode({ t: last.created_at.toISOString(), id: last.id })
      : null,
  };
}`,
        },
        {
          language: 'sql',
          title: 'Why deep offsets hurt',
          code: `-- Offset: scans and discards 1,000,000 index entries/rows to return 50
EXPLAIN ANALYZE SELECT * FROM orders ORDER BY created_at DESC, id DESC OFFSET 1000000 LIMIT 50;
-- Keyset: seeks directly to the bookmark, reads ~50 rows
EXPLAIN ANALYZE SELECT * FROM orders
WHERE (created_at, id) < ('2026-03-01T10:00:00Z', 'ord_9f2c')
ORDER BY created_at DESC, id DESC LIMIT 50;`,
        },
      ],
      keyPoints: [
        'Wrap collections in an object from day one.',
        'Keyset pagination: row-value comparison + total order + matching index + opaque cursor.',
        'Allow-list and index filters/sorts; cap page size; avoid default total counts.',
      ],
      source: 'Mastering API Architecture — Ch 1 (Collections and Pagination, Filtering)',
    },
    {
      heading: '5. Idempotency keys for POST',
      body: `**Intuition:** a coat-check ticket. If you hand in the same ticket twice, you get the same coat, not a second coat.

Networks fail *after* the server did the work: the client times out on \`POST /payments\` and has no idea whether it was charged. Without idempotency the only safe choice is not to retry — which means lost payments — or to retry and risk double charges.

**Protocol (Stripe-style; IETF draft \`Idempotency-Key\` header)**
1. Client generates a unique key (UUIDv4) **per logical operation** and sends \`Idempotency-Key: <key>\`. Retries reuse the same key.
2. Server atomically **claims** the key (unique constraint): \`INSERT … ON CONFLICT DO NOTHING\`, storing a hash of the request (method + path + body) and the caller identity.
3. If the claim succeeds → execute, then store status code + response body with the key.
4. If the key exists:
   - completed + same request hash → **replay the stored response** (same status and body);
   - completed + different hash → **422** (key reused for a different request);
   - still in progress → **409** (client should retry later) — never execute twice concurrently.
5. Keys expire after a retention window (Stripe: 24 hours).

**Subtleties**
- Scope keys per account/API key (two customers may generate the same UUID in theory; more importantly, don't leak responses across tenants).
- Store the result **in the same transaction** as the side effect when possible (same DB), so "did the work but didn't record it" can't happen. When the side effect is external (PSP call), pass the key through to the PSP.
- Only cache final outcomes: don't store 5xx/transient errors as the permanent answer, or retries can never succeed.
- Idempotency is also how you make **queue consumers** safe (dedupe by message ID).`,
      code: [
        {
          language: 'sql',
          title: 'Idempotency table',
          code: `CREATE TABLE idempotency_keys (
  account_id     text        NOT NULL,
  key            text        NOT NULL,
  request_hash   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'in_progress',  -- in_progress | completed
  response_code  int,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
-- Expire after 24h (cron, or partition by day and drop old partitions)
DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';`,
        },
        {
          language: 'typescript',
          title: 'Claim → execute → store, in one transaction with the side effect',
          code: `import { createHash } from 'node:crypto';
import { Pool } from 'pg';
const db = new Pool();

export async function createOrderIdempotent(accountId: string, key: string, body: unknown) {
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      'INSERT INTO idempotency_keys (account_id, key, request_hash) VALUES ($1, $2, $3) ' +
      'ON CONFLICT DO NOTHING RETURNING key', [accountId, key, hash]);

    if (claim.rowCount === 0) {                    // key already exists
      await client.query('ROLLBACK');
      const { rows: [prev] } = await db.query(
        'SELECT request_hash, status, response_code, response_body FROM idempotency_keys ' +
        'WHERE account_id = $1 AND key = $2', [accountId, key]);
      if (prev.request_hash !== hash) return { status: 422, body: { title: 'Idempotency-Key reused with different request' } };
      if (prev.status !== 'completed') return { status: 409, body: { title: 'Request with this key is in progress' } };
      return { status: prev.response_code, body: prev.response_body };   // replay
    }

    const { rows: [order] } = await client.query(
      'INSERT INTO orders (account_id, payload) VALUES ($1, $2) RETURNING id, created_at', [accountId, body]);
    const response = { id: order.id, createdAt: order.created_at };
    await client.query(
      "UPDATE idempotency_keys SET status = 'completed', response_code = 201, response_body = $3 " +
      'WHERE account_id = $1 AND key = $2', [accountId, key, response]);
    await client.query('COMMIT');                  // order + recorded response commit atomically
    return { status: 201, body: response };
  } catch (e) {
    await client.query('ROLLBACK');                // claim released: a retry can execute
    throw e;
  } finally { client.release(); }
}`,
        },
      ],
      keyPoints: [
        'Client key per logical operation; retries reuse it.',
        'Atomic claim; replay completed responses; 409 in-flight; 422 on body mismatch.',
        'Record the response in the same transaction as the side effect; expire keys.',
      ],
      source: 'Stripe API — Idempotent requests',
    },
    {
      heading: '6. ETags and conditional requests',
      body: `**Intuition:** an ETag is a fingerprint of a resource version. "Only send it if it changed" saves bandwidth; "only update it if it's still the version I read" prevents two editors from overwriting each other.

**Caching / bandwidth — If-None-Match**
- Server returns \`ETag: "v42"\` (a hash of the representation or a version number).
- Client revalidates with \`If-None-Match: "v42"\` → **304 Not Modified** with no body if unchanged. Combined with \`Cache-Control: max-age=60\`, CDNs and browsers can serve without hitting you at all.
- Cheap ETags come from a \`version\`/\`updated_at\` column, not from serialising and hashing a large body on every request.

**Optimistic concurrency — If-Match**
- The classic **lost update**: Alice and Bob both GET an order (v7), both PUT changes; Bob silently overwrites Alice's.
- With \`If-Match: "7"\` on PUT/PATCH/DELETE, the server applies the change only if the current version is still 7 (\`UPDATE … WHERE id = $1 AND version = 7\`); otherwise **412 Precondition Failed**. The client re-reads and merges.
- Return **428 Precondition Required** if the client omits If-Match on resources where lost updates matter.

**Strong vs weak ETags:** \`W/"v42"\` (weak) means semantically equivalent, not byte-identical; If-Match requires **strong** comparison, so weak ETags never match there. Many frameworks (Express) generate weak ETags by default for GET caching — fine for If-None-Match, not for concurrency control.

**GraphQL/gRPC:** no built-in HTTP conditional semantics — pass an explicit \`version\`/\`expectedVersion\` field in mutations.`,
      code: [
        {
          language: 'typescript',
          title: 'GET with 304 and PATCH with If-Match → 412/428',
          code: `import { Controller, Get, Patch, Param, Body, Headers, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

@Controller('/v1/orders')
export class OrdersController {
  constructor(private readonly repo: OrdersRepo) {}

  @Get(':id')
  async get(@Param('id') id: string, @Headers('if-none-match') inm: string | undefined, @Res() res: Response) {
    const order = await this.repo.find(id);            // includes integer "version"
    const etag = '"' + order.version + '"';
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    if (inm === etag) return res.status(HttpStatus.NOT_MODIFIED).end();
    return res.json(order);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Headers('if-match') ifMatch: string | undefined,
              @Body() patch: Partial<OrderPatch>, @Res() res: Response) {
    if (!ifMatch) return res.status(428).json({ title: 'If-Match header required' });
    const expected = Number(ifMatch.replace(/"/g, ''));
    // UPDATE orders SET ..., version = version + 1 WHERE id = $1 AND version = $2 RETURNING *
    const updated = await this.repo.updateIfVersion(id, expected, patch);
    if (!updated) return res.status(HttpStatus.PRECONDITION_FAILED).json({ title: 'Resource changed; re-fetch and retry' });
    res.setHeader('ETag', '"' + updated.version + '"');
    return res.json(updated);
  }
}`,
        },
      ],
      keyPoints: [
        'If-None-Match → 304 for bandwidth; derive ETags from versions.',
        'If-Match → 412 prevents lost updates; 428 to require it.',
        'Weak ETags never satisfy If-Match.',
      ],
    },
    {
      heading: '7. Bulk APIs and partial failures',
      body: `**Intuition:** a bulk endpoint is a shopping trolley instead of carrying items one by one — faster, but you need a clear receipt saying which items made it.

**Why bulk:** 10,000 single-item calls at 20 ms each = 200 s of round trips; one bulk call with 500 items per request = 20 calls. Bulk also reduces per-request overhead (auth, TLS, logging).

**Design choices**
- **Atomic (all-or-nothing):** one transaction; any failure → 4xx and nothing applied. Simple for clients, limited by transaction size and lock duration.
- **Partial success (most common for imports):** process each item independently and return **per-item results**. Options: \`207 Multi-Status\` (WebDAV origin; some teams avoid it) or \`200\` with a \`results\` array — pick one and document it. Never return plain 200 while silently dropping failed items.
- **Async bulk:** for large batches, \`POST /imports\` → \`202 Accepted\` + \`Location: /imports/{id}\`; client polls or receives a webhook; results downloadable (e.g. S3 pre-signed URL).

**Rules**
- **Limit batch size** (e.g. ≤ 500 items or ≤ 1–5 MB) to bound latency and memory.
- **Correlate** results with inputs (client-supplied \`ref\` per item, or same index order).
- **Per-item idempotency** (item keys) so retrying a partially failed batch doesn't duplicate the successes; or batch-level Idempotency-Key replaying the full result.
- Errors per item use the same problem format.
- Rate-limit by cost (items), not by requests.`,
      code: [
        {
          language: 'json',
          title: 'Partial-success response for POST /v1/products:batchUpsert',
          code: `{
  "summary": { "received": 3, "succeeded": 2, "failed": 1 },
  "results": [
    { "ref": "sku-1001", "status": 200, "id": "prod_8x1" },
    { "ref": "sku-1002", "status": 201, "id": "prod_8x2" },
    {
      "ref": "sku-1003",
      "status": 422,
      "error": {
        "type": "https://api.example.com/problems/validation-error",
        "title": "Invalid product",
        "errors": [{ "pointer": "/price", "detail": "must be > 0" }]
      }
    }
  ]
}`,
        },
      ],
      keyPoints: [
        'Decide atomic vs partial vs async; document it.',
        'Per-item results correlated by ref; same error format per item.',
        'Cap batch size; per-item idempotency for safe retries.',
      ],
    },
    {
      heading: '8. GraphQL: schema design, N+1 and DataLoader, cost limits, persisted queries',
      body: `**Intuition:** GraphQL is a menu where the client composes its own plate — perfect for UIs that need "exactly these fields from five services", dangerous if the kitchen never says "that order is too big".

The book frames GraphQL as a query layer over existing services/datastores that lets consumers ask for exactly what they need — strong for UIs and aggregation, and usable as a facade over legacy systems.

**Schema design**
- Model the domain graph, not your tables. Use **Relay-style connections** for lists (\`edges { node cursor }\`, \`pageInfo { hasNextPage endCursor }\`) — cursor pagination built in.
- Mutations take an \`input\` type and return a **payload** type (\`{ order, userErrors { field message } }\`) — business errors as data, transport/system errors in \`errors\`.
- Nullability: fields that come from other services should often be nullable so one failing resolver doesn't null out the whole parent.
- Evolve by adding fields and \`@deprecated(reason:)\` rather than versioning the endpoint.

**N+1 problem:** querying 50 orders and their customers runs 1 query for orders + 50 for customers (resolver per field). **DataLoader** collects all keys requested in the same tick and issues one batched call (\`WHERE id = ANY($1)\`), and caches per request. Create loaders **per request** (cache must not leak across users).

**Abuse protection:** a single query can request \`users { friends { friends { friends … } } }\`. Enforce **max depth**, **query cost/complexity** (weights × list sizes, reject above a budget, and rate-limit by cost), max page sizes (\`first ≤ 100\`), and timeouts. Disable introspection in production for private APIs if it isn't needed.

**Persisted queries**
- **Automatic persisted queries (APQ):** client sends the SHA-256 hash; server looks it up; on miss, client resends the full query once. Saves bandwidth and enables **GET** requests → CDN-cacheable.
- **Trusted documents / allow-list:** only pre-registered query hashes are accepted — the strongest defence against arbitrary expensive queries for first-party clients.

**HTTP caching** is weaker than REST (single POST endpoint); rely on persisted GETs, per-field cache hints, or response caching in the gateway. Errors often come back as HTTP 200 with an \`errors\` array — monitoring must inspect the body.`,
      code: [
        {
          language: 'graphql',
          title: 'Schema: connections, payload types with user errors, deprecation',
          code: `type Query {
  order(id: ID!): Order
  orders(first: Int = 20, after: String, status: OrderStatus): OrderConnection!
}

type Order {
  id: ID!
  status: OrderStatus!
  total: Money!
  customer: Customer          # nullable: resolved from another service
  placedAt: DateTime!
  legacyRef: String @deprecated(reason: "Use id; removed after 2026-12-31")
}

type OrderConnection { edges: [OrderEdge!]!  pageInfo: PageInfo! }
type OrderEdge { node: Order!  cursor: String! }
type PageInfo { hasNextPage: Boolean!  endCursor: String }

input CancelOrderInput { orderId: ID!  reason: String  expectedVersion: Int! }
type CancelOrderPayload { order: Order  userErrors: [UserError!]! }
type UserError { field: [String!]  message: String!  code: String! }

type Mutation { cancelOrder(input: CancelOrderInput!): CancelOrderPayload! }`,
        },
        {
          language: 'typescript',
          title: 'Per-request DataLoader removes N+1',
          code: `import DataLoader from 'dataloader';
import { Pool } from 'pg';
const db = new Pool();

interface Customer { id: string; name: string }

// Called once per incoming GraphQL request (in the context factory)
export function createLoaders() {
  return {
    customerById: new DataLoader<string, Customer | null>(async (ids) => {
      // One query for all customer ids requested in this tick
      const { rows } = await db.query<Customer>('SELECT id, name FROM customers WHERE id = ANY($1)', [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id) ?? null);     // same order and length as ids
    }, { maxBatchSize: 500 }),
  };
}

export const resolvers = {
  Order: {
    customer: (order: { customerId: string }, _args: unknown, ctx: { loaders: ReturnType<typeof createLoaders> }) =>
      ctx.loaders.customerById.load(order.customerId),   // 50 orders -> 1 SQL query, not 50
  },
};`,
        },
      ],
      keyPoints: [
        'Connections for pagination; payload types with userErrors; nullable cross-service fields.',
        'DataLoader per request batches and de-duplicates resolver fetches.',
        'Depth/cost limits and trusted persisted queries; monitor errors in 200 responses.',
      ],
      source: 'Mastering API Architecture — Ch 1 (GraphQL); GraphQL Cursor Connections Specification',
    },
    {
      heading: '9. gRPC: protobuf, HTTP/2, deadlines and streaming',
      body: `**Intuition:** gRPC is calling a function on another machine with a strongly typed, compact envelope, over a single multiplexed pipe.

**Why gRPC for east-west traffic** (Mastering API Architecture): east-west services are higher-traffic, and **one north-south request often fans out into many east-west calls**, so their overhead compounds. Protobuf's binary encoding is typically several times smaller and faster to parse than JSON, and **HTTP/2 multiplexing** lets many concurrent requests share one TCP connection (the book's example: fetching 20 attendees as 20 HTTP/1.1 requests would need up to 20 connections; HTTP/2 multiplexes them over one).

**Protobuf essentials:** fields are identified on the wire by **field numbers**, not names — so renaming is wire-safe, but changing a number or type breaks compatibility (details in api-evolution). \`proto3\` fields are optional by default; use \`optional\` for explicit presence.

**Four call types**
| Type | Shape | Example |
|---|---|---|
| Unary | 1 request → 1 response | GetOrder |
| Server streaming | 1 request → stream | Subscribe to price ticks, large result sets |
| Client streaming | stream → 1 response | Upload telemetry batch |
| Bidirectional | stream ↔ stream | Chat, collaborative editing, real-time bidding |

**Deadlines:** clients set a deadline; it's sent as the \`grpc-timeout\` header and the server sees the remaining time (\`call.getDeadline()\`), can cancel work, and propagate it to downstream calls. Default is **no deadline** — always set one. Error \`DEADLINE_EXCEEDED\` (code 4).

**Operational gotchas**
- **Load balancing:** HTTP/2 connections are long-lived, so an L4 load balancer pins all of a client's calls to one backend. Use L7 (Envoy/mesh, xDS) or client-side balancing (\`round_robin\` over DNS/xDS).
- **Browsers** can't speak native gRPC — use gRPC-Web, Connect, or REST transcoding (grpc-gateway / Envoy \`grpc_json_transcoder\`) for public clients. The book cautions that generating one spec from the other (OpenAPI ↔ proto) conflates REST's resource model with RPC and complicates compatibility.
- Rich status codes (\`UNAVAILABLE\` retryable, \`INVALID_ARGUMENT\` not) and built-in retry policies/hedging via service config.`,
      code: [
        {
          language: 'protobuf',
          title: 'orders.proto — unary + server streaming',
          code: `syntax = "proto3";
package shop.orders.v1;

import "google/protobuf/timestamp.proto";

service OrderService {
  rpc GetOrder(GetOrderRequest) returns (Order);
  // Server streaming: large exports without buffering everything in memory
  rpc StreamOrders(StreamOrdersRequest) returns (stream Order);
}

message GetOrderRequest { string id = 1; }

message StreamOrdersRequest {
  string customer_id = 1;
  google.protobuf.Timestamp since = 2;
}

message Order {
  string id = 1;
  string customer_id = 2;
  OrderStatus status = 3;
  int64 total_cents = 4;
  google.protobuf.Timestamp placed_at = 5;
  reserved 6;                  // removed field: number can never be reused
  reserved "coupon_code";
}

enum OrderStatus {
  ORDER_STATUS_UNSPECIFIED = 0; // proto3 default must be a safe "unknown"
  ORDER_STATUS_PLACED = 1;
  ORDER_STATUS_SHIPPED = 2;
}`,
        },
        {
          language: 'typescript',
          title: 'Node client with a deadline and status-aware handling (@grpc/grpc-js)',
          code: `import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const def = protoLoader.loadSync('orders.proto', { keepCase: false, longs: String, defaults: true });
const pkg = grpc.loadPackageDefinition(def) as any;

// Client-side round-robin over all resolved addresses (avoids pinning to one backend)
const client = new pkg.shop.orders.v1.OrderService(
  'dns:///orders.internal:50051',
  grpc.credentials.createInsecure(), // use TLS/mTLS in production
  { 'grpc.service_config': JSON.stringify({ loadBalancingConfig: [{ round_robin: {} }] }) },
);

export function getOrder(id: string, budgetMs = 300): Promise<unknown> {
  return new Promise((resolve, reject) => {
    client.GetOrder({ id }, { deadline: Date.now() + budgetMs }, (err: grpc.ServiceError | null, res: unknown) => {
      if (!err) return resolve(res);
      if (err.code === grpc.status.DEADLINE_EXCEEDED) return reject(new Error('orders timed out'));
      if (err.code === grpc.status.NOT_FOUND) return resolve(null);
      reject(err); // UNAVAILABLE is retryable by policy; INVALID_ARGUMENT is not
    });
  });
}`,
        },
      ],
      keyPoints: [
        'Binary protobuf + HTTP/2 multiplexing suit high-traffic east-west calls.',
        'Always set deadlines; they propagate via grpc-timeout.',
        'Long-lived connections need L7 or client-side load balancing; browsers need gRPC-Web/transcoding.',
      ],
      source: 'Mastering API Architecture — Ch 1 (Implementing RPC with gRPC, HTTP/2 Performance Benefits)',
    },
    {
      heading: '10. Choosing a format: the ADR, BFFs and multiple specifications',
      body: `**Intuition:** REST, GraphQL and gRPC are not rivals; they are tools for different exchanges. The question the book asks is not "REST or gRPC?" but "given this exchange, which is most appropriate?"

**Mastering API Architecture's modeling-exchanges guideline (ADR input)**
- Is the exchange **north-south** (external consumers, over the internet) or **east-west** (inside your ecosystem)? Do you **control the consumer's code**?
- Is there a strong business domain across services, or should consumers compose their own queries?
- What versioning considerations apply? How often does the underlying data model change?
- Is it a **high-traffic** service where bandwidth or performance concerns have been raised?
- Recommendations: external consumers → **REST** (low barrier, strong domain model, loose coupling). Two services under the producer's control, or a service proven to be high-traffic → consider **gRPC**.

| Criterion | REST + OpenAPI | GraphQL | gRPC |
|---|---|---|---|
| Best for | Public/partner APIs, CRUD resources | UI aggregation across many services, varied clients | Internal high-throughput, streaming, polyglot services |
| Caching | Excellent (HTTP, CDN, ETags) | Hard (POST); needs persisted GETs | None at HTTP layer |
| Payload efficiency | JSON, verbose (gzip helps) | Only requested fields | Compact binary |
| Contract | OpenAPI (loose at runtime unless validated) | Typed schema, introspection | Strict .proto, codegen |
| Browser support | Native | Native | gRPC-Web/transcoding |
| Main risks | Over/under-fetching, chatty clients | N+1, unbounded query cost, complexity | L4 LB pinning, debugging binary, breaking field numbers |

**BFF (Backend for Frontend):** a thin API per client type (web, iOS, partner) that aggregates and shapes downstream calls for that UI. Alternative to a general GraphQL layer; keeps mobile-specific concerns (payload size, round trips) out of core services. Risk: duplicated logic across BFFs — keep domain logic in services.

**Multiple specifications:** you *can* expose REST, gRPC and GraphQL for the same capability, but the book warns that generating one spec from another is fragile — e.g. openapi2proto orders fields alphabetically by default, so adding a field renumbers the others and breaks the binary format. Its recommendation (recorded as an ADR in the case study): design the east-west RPC contracts **independently** from the north-south REST representation so both evolve freely.

**OpenAPI** is the shared contract for REST: code generation (OpenAPI Generator), request/response validation (e.g. Atlassian's swagger-request-validator, useful even in a DMZ to reject non-conforming traffic), examples and mock servers, and breaking-change detection in CI (see api-evolution). Note that a spec describes the *shape*, not full *behaviour* — contract tests cover the rest.`,
      code: [
        {
          language: 'yaml',
          title: 'OpenAPI 3.1 excerpt: paginated collection, idempotency header, problem responses',
          code: `openapi: 3.1.0
info: { title: Orders API, version: 1.4.0 }
paths:
  /v1/orders:
    get:
      operationId: listOrders
      parameters:
        - { name: after, in: query, schema: { type: string }, description: Opaque cursor }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
      responses:
        '200':
          description: A page of orders
          content:
            application/json:
              schema:
                type: object
                required: [value]
                properties:
                  value: { type: array, items: { $ref: '#/components/schemas/Order' } }
                  nextCursor: { type: [string, 'null'] }
    post:
      operationId: createOrder
      parameters:
        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, maxLength: 255 } }
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/NewOrder' } } }
      responses:
        '201': { description: Created, headers: { Location: { schema: { type: string } } } }
        '409': { $ref: '#/components/responses/Problem' }
        '422': { $ref: '#/components/responses/Problem' }
components:
  responses:
    Problem:
      description: Error
      content: { application/problem+json: { schema: { $ref: '#/components/schemas/Problem' } } }
  schemas:
    Problem:
      type: object
      properties: { type: { type: string }, title: { type: string }, status: { type: integer }, detail: { type: string } }
    Order: { type: object, properties: { id: { type: string }, status: { type: string } } }
    NewOrder: { type: object, required: [items], properties: { items: { type: array, items: { type: object } } } }`,
        },
      ],
      keyPoints: [
        'North-south → REST; high-traffic east-west → gRPC; UI aggregation → GraphQL or BFF.',
        'Record the choice as an ADR with the book\'s discussion points.',
        'Don\'t auto-generate one spec from another; evolve REST and RPC contracts independently.',
      ],
      source: 'Mastering API Architecture — Ch 1 (ADR Guideline, Modeling Exchanges, Multiple Specifications, OpenAPI)',
    },
    {
      heading: '11. Performance at the API layer: payload size, compression, round trips',
      body: `**Intuition:** most slow APIs aren't slow because of CPU — they move too many bytes, make too many round trips, or ask the database the same question 50 times.

**Checklist**
- **Payload size:** JSON is verbose; response of 2 MB at 20 Mbps mobile ≈ 0.8 s just to download. Use field selection (\`?fields=id,status\` / sparse fieldsets), pagination, and remove unused expansions. The book notes that "human readability" is a weak argument for JSON when payloads are large; parsing cost varies a lot by language, so measure.
- **Compression:** gzip/brotli typically shrink JSON 5–10×; enable at the edge/gateway (\`Content-Encoding: br\`), skip tiny bodies (< ~1 KB) and already-compressed content.
- **Round trips:** batch endpoints, \`?expand=customer\` embedding, GraphQL, or a BFF. On HTTP/1.1, browsers open ~6 connections per origin; HTTP/2 multiplexes; HTTP/3 (QUIC) avoids TCP head-of-line blocking on lossy mobile networks.
- **Keep-alive and connection reuse** between services (a new TLS handshake costs 1–2 RTTs plus crypto).
- **Server-side:** N+1 queries, missing indexes for filters/sorts, deep offsets, synchronous fan-out that could be parallel, serialising huge objects.
- **Streaming large results:** NDJSON or gRPC server streaming to avoid buffering; or **async export** (202 + job + download link to object storage) for very large datasets.
- **Caching:** \`Cache-Control\`, ETags, CDN for public GETs; application cache for expensive aggregates.`,
      code: [
        {
          language: 'typescript',
          title: 'Streaming a large export as NDJSON with backpressure (pg-query-stream)',
          code: `import { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';

const db = new Pool();

export async function exportOrders(customerId: string, res: Response) {
  const client = await db.connect();
  try {
    const rows = client.query(new QueryStream(
      'SELECT id, status, total_cents, created_at FROM orders WHERE customer_id = $1 ORDER BY id',
      [customerId], { batchSize: 1000 }));                 // server-side cursor, 1000 rows at a time
    const toNdjson = new Transform({
      writableObjectMode: true,
      transform(row, _enc, cb) { cb(null, JSON.stringify(row) + String.fromCharCode(10)); },
    });
    res.setHeader('Content-Type', 'application/x-ndjson');
    await pipeline(rows, toNdjson, res);                   // backpressure: slow client pauses the DB cursor
  } finally {
    client.release();
  }
}`,
        },
      ],
      keyPoints: [
        'Bytes and round trips dominate API latency more often than CPU.',
        'Field selection, pagination, compression, keep-alive, HTTP/2.',
        'Stream or export asynchronously instead of building giant responses.',
      ],
      source: 'Mastering API Architecture — Ch 1 (High-Traffic Services, Large Exchange Payloads, HTTP/2)',
    },
    {
      heading: '12. Scenario playbook',
      body: `| Scenario | Diagnose | Fix |
|---|---|---|
| **API is slow** | Break down latency: network (payload size, TLS, round trips) vs server (DB time per request, N+1 count, fan-out) using traces; check p50 vs p99 | Index-backed queries, DataLoader/batch fetch, parallel fan-out with timeouts, compression, field selection, caching with ETags, keyset pagination |
| **100K RPS** | Read/write mix, cacheability, payload size, per-request DB work | CDN + Cache-Control for public GETs, conditional requests, app cache, stateless horizontal scale behind L7 LB, gRPC for internal hops, connection pooling, rate limits per client, async (202) for writes that can be deferred |
| **Response too large** | Size distribution of responses, which fields clients actually use | Pagination with caps, sparse fieldsets, compression, streaming (NDJSON/gRPC stream), async export to object storage with pre-signed URL |
| **Pagination over millions of rows** | Offset depth, sort columns, total counts | Keyset cursor with composite index and tiebreaker, opaque cursors, drop default COUNT(*), search index for complex filter+sort combinations |
| **Client retries the same request** | Which methods, how duplicates manifest (double orders/charges) | Idempotency-Key for POST (claim/replay/409/422), idempotent PUT/DELETE semantics, If-Match for updates, dedupe in async consumers |

**Interview framing:** start from the contract (resources, methods, status codes, errors), then the data access pattern behind each endpoint (index, pagination), then the reliability semantics (idempotency, conditional requests), then scale (caching, protocol choice).`,
      keyPoints: [
        'Diagnose with traces: bytes vs round trips vs DB work.',
        'Keyset pagination and caps for big collections; idempotency for retries.',
        'Contract → data access → reliability semantics → scale.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'api-design-cc-1',
      title: 'The order-history endpoint that melts at page 2,000',
      context:
        'GET /orders powers the customer order-history screen and a partner export. Customers with ~200K orders (B2B accounts) see 10-second responses; the partner export paginates to page 4,000 and times out. Mobile clients complain the response is 3 MB. The DB shows thousands of identical "SELECT * FROM customers WHERE id = $1" queries.',
      task:
        'Refactor the endpoint for predictable latency at any depth, bounded payload size, a stable page sequence while new orders arrive, and no N+1 queries — without breaking the ability to evolve the response later.',
      starter: {
        language: 'typescript',
        code: `@Get('/orders')
async list(@Query('page') page = '1', @Query('pageSize') pageSize = '100', @Req() req: AuthedRequest) {
  const size = Number(pageSize);                 // client can ask for 100000
  const offset = (Number(page) - 1) * size;

  const orders = await this.db.query(
    'SELECT * FROM orders WHERE account_id = $1 ORDER BY created_at DESC OFFSET $2 LIMIT $3',
    [req.accountId, offset, size]);
  const total = await this.db.query('SELECT count(*) FROM orders WHERE account_id = $1', [req.accountId]);

  for (const o of orders.rows) {
    // attach customer for display
    o.customer = (await this.db.query('SELECT * FROM customers WHERE id = $1', [o.customer_id])).rows[0];
  }
  return orders.rows;                            // bare array
}`,
      },
      hints: [
        'What does the database do with OFFSET 399900? What happens to page boundaries when a new order is inserted between two page requests?',
        'created_at alone is not unique — what does that do to a cursor? Which index supports the query?',
        'How many queries run for a page of 100 orders? Why is returning a bare array a problem for adding a next link later?',
      ],
      solution: {
        language: 'typescript',
        code: `const MAX_LIMIT = 200;
const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as { t: string; id: string };

// Index: CREATE INDEX CONCURRENTLY orders_acct_created_id ON orders (account_id, created_at DESC, id DESC);
@Get('/v1/orders')
async list(@Query('after') after: string | undefined, @Query('limit') limitQ = '50',
           @Query('includeTotal') includeTotal: string | undefined, @Req() req: AuthedRequest) {
  const limit = Math.min(Math.max(Number(limitQ) || 50, 1), MAX_LIMIT);   // server-side cap
  let c: { t: string; id: string } | null = null;
  try { c = after ? decode(after) : null; } catch { throw new BadRequestException('invalid cursor'); }

  const { rows } = await this.db.query(
    // explicit columns (no SELECT *), keyset predicate with id tiebreaker
    'SELECT id, status, total_cents, currency, created_at, customer_id FROM orders ' +
    'WHERE account_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3)) ' +
    'ORDER BY created_at DESC, id DESC LIMIT $4',
    [req.accountId, c?.t ?? null, c?.id ?? null, limit + 1]);

  const page = rows.slice(0, limit);
  // One batched lookup for all customers on the page (no N+1)
  const ids = [...new Set(page.map((o) => o.customer_id))];
  const { rows: customers } = await this.db.query(
    'SELECT id, display_name FROM customers WHERE id = ANY($1)', [ids]);
  const byId = new Map(customers.map((cu) => [cu.id, cu]));

  const last = page[page.length - 1];
  return {
    value: page.map(({ customer_id, ...o }) => ({ ...o, customer: byId.get(customer_id) ?? null })),
    nextCursor: rows.length > limit ? encode({ t: last.created_at.toISOString(), id: last.id }) : null,
    // exact totals are opt-in: COUNT(*) over 200K rows on every page is wasted work
    ...(includeTotal === 'true' ? { total: await this.countCached(req.accountId) } : {}),
  };
}`,
      },
      explanation: `**Fixes:**

- **Keyset pagination** replaces \`OFFSET\`: the DB seeks directly to the bookmark using the \`(account_id, created_at DESC, id DESC)\` index, so page 4,000 costs the same as page 1 (~50–200 rows read instead of 400K scanned and discarded).
- **Stable under inserts:** new orders appear "before" the cursor, so pages never shift or duplicate items mid-export.
- **Total order:** \`id\` tiebreaker ensures orders with the same \`created_at\` aren't skipped or repeated at page boundaries.
- **Opaque cursor** (base64url) lets you change the sort encoding later; invalid cursors → 400.
- **Bounded payload:** limit capped at 200 (was unlimited), explicit columns instead of \`SELECT *\`, and the customer embed trimmed to what the screen needs — 3 MB → tens of KB.
- **N+1 removed:** one \`ANY($1)\` query for all customers on the page (100 queries → 1).
- **Count on demand:** \`COUNT(*)\` ran on every page; now opt-in and cached.
- **Envelope object:** \`{ value, nextCursor }\` instead of a bare array, so fields can be added later without a breaking change; versioned path \`/v1\`.`,
      followUps: [
        {
          "q": "Product wants a 'Previous page' button too. How do you extend the keyset design?",
          "a": "Return two cursors: `nextCursor` from the last row and `prevCursor` from the first row. For a 'before' request, flip the comparison and the sort, `(created_at, id) > ($t, $id) ORDER BY created_at ASC, id ASC LIMIT n+1`, then reverse the rows in the application before returning, so the page still displays newest-first. The same index serves both directions because Postgres can scan a B-tree backwards. Put the direction inside the opaque cursor so clients can't mix them up."
        },
        {
          "q": "How would you load-test this to prove page 4,000 is as fast as page 1?",
          "a": "Seed a staging DB with a realistic B2B account (200K+ orders with clustered timestamps, so there are many ties). Run a crawler with k6 or a script that walks all pages via `nextCursor`, recording latency per page number. Assert that p99 is flat across depth (for example under 50 ms at page 1 and page 4,000) and that the set of ids returned has no gaps or duplicates while a background writer inserts new orders. Also capture `EXPLAIN (ANALYZE, BUFFERS)` for a deep cursor: buffers read should be about 100, not 400K."
        }
      ],
    },
    {
      id: 'api-design-cc-2',
      title: 'Double charges from a "simple" payments endpoint',
      context:
        'Mobile clients on flaky networks retry POST /payments after a 10-second timeout. Finance found ~0.3% of payments were charged twice. A quick fix added an in-memory Set of recent request IDs, but duplicates continue — the service runs on 12 pods.',
      task:
        'Make POST /payments safe to retry across pods, concurrent duplicates and crashes, returning the original result for replays, and rejecting misuse of the same key.',
      starter: {
        language: 'typescript',
        code: `const seen = new Set<string>();   // "idempotency"

@Post('/payments')
async create(@Body() dto: CreatePaymentDto, @Headers('x-request-id') requestId: string) {
  if (seen.has(requestId)) {
    return { status: 'duplicate' };            // client gets a different body than the original
  }
  const charge = await this.psp.charge({ amount: dto.amount, card: dto.cardToken });
  await this.db.query('INSERT INTO payments (id, amount, psp_charge_id) VALUES ($1, $2, $3)',
    [charge.id, dto.amount, charge.id]);
  seen.add(requestId);                        // added only after success, per pod
  return { id: charge.id, status: 'succeeded' };
}`,
      },
      hints: [
        'Where is "seen" stored, and what happens when the retry lands on a different pod, or the pod restarts?',
        'Two identical requests arrive 5 ms apart. Both check the Set before either adds to it. What happens?',
        'If the PSP charge succeeds but the process crashes before the INSERT, what does the retry do? How can the PSP help?',
      ],
      solution: {
        language: 'typescript',
        code: `@Post('/v1/payments')
async create(@Body() dto: CreatePaymentDto, @Headers('idempotency-key') key: string | undefined,
             @Req() req: AuthedRequest, @Res() res: Response) {
  if (!key || key.length > 255) throw new BadRequestException('Idempotency-Key header required');
  const hash = sha256(JSON.stringify({ amount: dto.amount, currency: dto.currency, card: dto.cardToken }));

  // 1) Atomic claim in the shared DB (PK: account_id, key) — works across all pods
  const claimed = await this.db.query(
    'INSERT INTO idempotency_keys (account_id, key, request_hash) VALUES ($1, $2, $3) ' +
    'ON CONFLICT DO NOTHING RETURNING key', [req.accountId, key, hash]);

  if (claimed.rowCount === 0) {
    const prev = await this.idem.get(req.accountId, key);
    if (prev.request_hash !== hash) return res.status(422).json({ title: 'Idempotency-Key reused with a different request' });
    if (prev.status !== 'completed') return res.status(409).setHeader('Retry-After', '1').json({ title: 'Request in progress' });
    return res.status(prev.response_code).json(prev.response_body);          // exact replay
  }

  try {
    // 2) Pass the SAME key to the PSP: if we crashed after charging last time,
    //    the PSP returns the original charge instead of charging again.
    const charge = await this.psp.charge(
      { amount: dto.amount, currency: dto.currency, card: dto.cardToken },
      { idempotencyKey: req.accountId + ':' + key, timeoutMs: 8000 });

    const body = { id: charge.id, status: charge.status, amount: dto.amount };
    // 3) Record payment + final response atomically
    await this.db.tx(async (t) => {
      await t.query('INSERT INTO payments (id, account_id, amount, psp_charge_id) VALUES ($1, $2, $3, $4) ' +
                    'ON CONFLICT (psp_charge_id) DO NOTHING', [charge.id, req.accountId, dto.amount, charge.id]);
      await t.query("UPDATE idempotency_keys SET status = 'completed', response_code = 201, response_body = $3 " +
                    'WHERE account_id = $1 AND key = $2', [req.accountId, key, body]);
    });
    return res.status(201).json(body);
  } catch (err) {
    if (isDefinitiveDecline(err)) {          // card declined: a final answer, safe to store and replay
      const body = { title: 'Card declined', code: (err as { code: string }).code };
      await this.idem.complete(req.accountId, key, 402, body);
      return res.status(402).json(body);
    }
    // Unknown outcome (timeout/5xx): release the claim so a retry re-runs; PSP key prevents a double charge
    await this.idem.release(req.accountId, key);
    throw new ServiceUnavailableException('Payment status unknown, retry with the same Idempotency-Key');
  }
}`,
      },
      explanation: `**Why the starter failed:** the Set was per pod and in memory (retries on other pods or after restarts weren't seen), check-then-add was racy (concurrent duplicates both passed), the key was added only *after* the charge (a timeout mid-charge left no record), and replays returned a different body than the original.

**Fixes:**
- **Shared, atomic claim** with a primary key on \`(account_id, key)\` — exactly one request wins, across all 12 pods.
- **Replay semantics:** same key + same request hash → the stored status and body; same key + different body → 422; still running → 409 with Retry-After.
- **End-to-end idempotency:** the same key is forwarded to the PSP, closing the crash window between "charged" and "recorded".
- **Atomic recording** of the payment and the final response; a unique constraint on \`psp_charge_id\` is a second safety net.
- **Only final outcomes are cached** (success, definitive decline). Unknown outcomes release the claim so a retry re-runs — and the PSP key makes that re-run safe.
- Standard \`Idempotency-Key\` header, scoped per account, length-limited; keys expire after 24h (cleanup job).`,
      followUps: [
        {
          "q": "The idempotency_keys table grows by 5M rows a day. How do you expire keys without hurting the hot path?",
          "a": "Keep a 24 h retention (Stripe's choice) and add a `created_at` column. Don't run a big `DELETE WHERE created_at < now() - interval '24h'`. That creates a huge transaction, WAL spikes and bloat. Partition the table by day (native range partitioning) and drop yesterday-minus-one partitions with `DROP TABLE`, which is instant. Alternatively, delete in small batches of about 5K rows using an index on `created_at`. Document that a key reused after expiry is treated as a new request."
        },
        {
          "q": "The PSP doesn't support idempotency keys. What changes in your crash-recovery story?",
          "a": "You lose end-to-end protection for the window between 'charge sent' and 'result recorded'. Mitigate it: before calling the PSP, persist an attempt row with your own reference (for example the payment id) in the charge's metadata or description. On retry with an unknown outcome, don't recharge. First query the PSP by that reference (search charges by metadata, or reconcile against its report). If it can't be queried synchronously, mark the payment `pending_reconciliation` and let a job resolve it from the PSP's settlement file before allowing a new attempt."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'api-design-iq-01',
      difficulty: 'hard',
      question:
        'Design the public REST API for an order management system used by merchants: orders, line items, cancellations, refunds and a nightly export. Walk me through resources, methods, status codes, errors and pagination.',
      whatInterviewerLooksFor: [
        'Clean resource model with state transitions as sub-resources',
        'Correct method and status semantics including async operations',
        'Consistent error model and pagination strategy',
        'Retry safety (idempotency, conditional updates)',
        'Mentions spec-first with OpenAPI and versioning strategy',
      ],
      modelAnswer: `### Resources
- \`/v1/orders\` (collection), \`/v1/orders/{orderId}\` (opaque IDs like \`ord_…\`), \`/v1/orders/{orderId}/line-items\`.
- State transitions as resources: \`POST /v1/orders/{id}/cancellation\` (idempotent by nature — one cancellation per order), \`POST /v1/orders/{id}/refunds\` (many refunds allowed → Idempotency-Key required).
- Exports: \`POST /v1/exports\` → **202** + \`Location: /v1/exports/{exportId}\`; poll or webhook; result is a short-lived pre-signed download URL.

### Methods and status codes
- \`POST /orders\` → 201 + Location; requires \`Idempotency-Key\`.
- \`GET /orders/{id}\` → 200 with ETag; 304 on If-None-Match; 404.
- \`PATCH /orders/{id}\` (JSON Merge Patch) with **If-Match** → 412 on version conflict, 428 if missing.
- Business rule violations (cancel a shipped order) → **409** with a problem type \`order-not-cancellable\`; validation → **422** with field pointers; rate limit → 429 + Retry-After.

### Errors
RFC 9457 problem+json everywhere; stable \`type\` URIs documented; trace ID extension; no internals leaked.

### Pagination and filtering
- \`GET /orders?status=open&createdAfter=…&limit=50&after=<cursor>\` → \`{ value, nextCursor }\`; keyset on \`(created_at, id)\`; limit ≤ 200; allow-listed, index-backed filters; totals opt-in.

### Evolution and contract
- Design-first **OpenAPI 3.1** spec in the repo, linted (naming/pagination rules), breaking-change check in CI, generated SDKs and mocks for partners.
- URI major version (\`/v1\`), additive changes within it, deprecation with Sunset header.

### Webhooks
Order events (\`order.paid\`, \`refund.succeeded\`) signed (HMAC), retried with backoff, idempotent by event ID — reduces polling load.`,
      followUps: [
        {
          q: 'Why model cancellation as POST /orders/{id}/cancellation rather than PATCH status=cancelled?',
          a: 'Cancellation has side effects (refunds, stock release) and rules; a dedicated resource makes intent explicit, allows its own validation/errors and audit data (reason, who), and keeps PATCH for plain field edits.',
        },
        {
          q: 'A merchant wants to update 5,000 orders\' tags at once. What do you add?',
          a: 'A bulk endpoint with per-item results (200 or 207 with a results array), ≤ 500 items per call or an async bulk job with 202, and per-item idempotency.',
        },
      ],
      pitfalls: [
        'Verbs in paths (/cancelOrder) and inconsistent status codes',
        'Offset pagination for exports over large histories',
        'No idempotency story for POST',
        'Different error shapes per endpoint',
      ],
    },
    {
      id: 'api-design-iq-02',
      difficulty: 'hard',
      question:
        'Our product-listing API\'s p99 went from 150 ms to 1.8 s over three months without traffic changes. How do you investigate and what are the usual culprits at the API layer?',
      whatInterviewerLooksFor: [
        'Systematic latency breakdown with tracing',
        'Knows common API-level causes (payload growth, N+1, offset depth, missing indexes)',
        'Distinguishes network/transfer time from server time',
        'Proposes targeted fixes with numbers',
      ],
      modelAnswer: `### Investigate
1. **Break down a slow request with distributed tracing**: gateway → service → DB/downstreams. Is the time in server processing, DB, downstream calls, or *transfer*?
2. Compare **response size** trend: slow growth in latency without traffic change often means data growth (bigger payloads, deeper pages, more rows per query).
3. Count **DB queries per request** (APM spans, \`pg_stat_statements\` calls per endpoint). 50+ similar queries → N+1.
4. Check query plans for filters/sorts added over time; look for seq scans.

### Usual culprits
- **Payload growth**: a nested \`variants\` array grew from 5 to 200 items; responses went from 40 KB to 2 MB. At 20 Mbps mobile that's 0.8 s just to transfer, plus JSON serialisation time on the server.
- **N+1**: per-item lookups for price/stock/reviews.
- **Deep offset pagination**: crawlers requesting page 5,000 → \`OFFSET 250000\`.
- **Unindexed filter/sort** added by a new feature.
- **Synchronous fan-out done sequentially** (price, then stock, then reviews) instead of in parallel with timeouts.
- **Compression disabled** at a new proxy, or TLS/keep-alive broken so every call pays a handshake.

### Fixes
- Sparse fieldsets / summary representation for lists; details on the item endpoint.
- Batch loaders (\`WHERE id = ANY($1)\`), parallel downstream calls with per-call timeouts.
- Keyset pagination and page size caps; block deep offsets for crawlers.
- Covering indexes for the common filter+sort combinations.
- Brotli/gzip at the edge; \`Cache-Control\` + ETags for anonymous listing pages; CDN.
- Add an SLO and a **payload-size budget** per endpoint in CI (e.g. p95 < 100 KB) to stop regression.`,
      followUps: [
        {
          q: 'Server spans show 120 ms but clients see 1.8 s. Where is the time?',
          a: 'Transfer and client-side: large payloads over slow networks, missing compression, no connection reuse (TLS per request), or queueing in a proxy. Check response size and client network timing (resource timing API/mobile RUM).',
        },
        {
          q: 'How do you stop this from recurring?',
          a: 'Per-endpoint latency SLOs, payload-size budgets, query-count assertions in integration tests, and slow-query alerts.',
        },
      ],
      pitfalls: [
        'Jumping to "add more servers" or "add Redis" before measuring',
        'Ignoring payload size and transfer time',
        'Only looking at averages',
      ],
    },
    {
      id: 'api-design-iq-03',
      difficulty: 'expert',
      question:
        'A read-heavy catalog API must serve 100K RPS globally with p99 < 100 ms. How do you design the API contract and serving path so it scales?',
      whatInterviewerLooksFor: [
        'Designs responses to be cacheable (URLs, headers, ETags)',
        'Uses CDN/edge and conditional requests effectively',
        'Chooses protocols for internal hops and connection reuse',
        'Plans capacity and protects origin with limits',
      ],
      modelAnswer: `### Make it cacheable by design
- **Stable, canonical URLs** (sorted/allow-listed query params) so CDN cache keys don't fragment.
- Split **public, shared data** (product details, prices by region) from **personalised data** (recommendations, cart) — personalised parts come from a separate endpoint or are composed client-side, so the heavy part is cacheable.
- \`Cache-Control: public, max-age=60, stale-while-revalidate=300, stale-if-error=86400\`; **ETags** derived from a version column; **conditional GETs** return 304.
- Purge/soft-purge on change events (surrogate keys by product ID) for freshness.

### Serving path
- **CDN** absorbs 90–99% of requests: at 95% hit ratio origin sees ~5K RPS.
- Origin: stateless API pods behind an L7 LB, **in-process + Redis cache** for hot aggregates, read replicas for misses.
- Internal fan-out (price, stock, media) via **gRPC with deadlines** over pooled HTTP/2 connections; parallel calls with a 30–50 ms budget and fallbacks (stale price allowed? — only for display, re-price at checkout).

### Payload
- Summary representation for listings (~2–5 KB), detail representation per item; brotli; images via CDN URLs, not inline.
- Keyset pagination for category listings; limit ≤ 100.

### Capacity and protection
- Origin sized for cache-miss storms (deploys, purges): request coalescing at CDN (collapsed forwarding) and in the service.
- Per-client rate limits at the edge; load shedding at origin.

### Numbers
- 100K RPS × 5 KB ≈ 500 MB/s ≈ 4 Gbps egress — mostly from the CDN. Origin at 5K RPS × ~10 ms CPU = 50 CPU-seconds/s ≈ 50 cores + headroom (e.g. 20 pods × 4 vCPU).`,
      followUps: [
        {
          q: 'Prices change every few seconds during flash sales. Still cacheable?',
          a: 'Yes with short max-age (1–5 s) plus stale-while-revalidate; or separate the price into its own tiny, short-TTL endpoint while the heavy product description caches for hours.',
        },
        {
          q: 'Would GraphQL work here?',
          a: 'Possible with persisted queries over GET for CDN caching, but REST resources with explicit cache headers are simpler to cache at 100K RPS; GraphQL shines for aggregation more than for edge caching.',
        },
      ],
      pitfalls: [
        'Mixing personalised and shared data in one response',
        'Unbounded query-param permutations fragmenting cache keys',
        'Scaling origin for 100K RPS instead of designing for cache hits',
      ],
    },
    {
      id: 'api-design-iq-04',
      difficulty: 'hard',
      question:
        'An audit-log API must let customers page through up to 500 million events per tenant, newest first, while new events keep arriving at 5K/s. Offset pagination is timing out. Design the pagination.',
      whatInterviewerLooksFor: [
        'Explains why offset fails (cost and drift)',
        'Designs keyset with tiebreaker, index and opaque cursor',
        'Handles filters and consistency for long scans',
        'Addresses totals and bulk export alternatives',
      ],
      modelAnswer: `### Why offset fails
- \`OFFSET n\` reads and discards n rows: page 100,000 of 50 = 5M rows per request.
- With 5K new events/s, the list shifts between requests — users see duplicates and gaps.

### Keyset design
- Sort key \`(occurred_at DESC, event_id DESC)\` — \`event_id\` (e.g. ULID/snowflake) breaks ties.
- Index \`(tenant_id, occurred_at DESC, event_id DESC)\`; with time partitioning (monthly partitions) queries touch only relevant partitions.
- Query: \`WHERE tenant_id = $1 AND (occurred_at, event_id) < ($2, $3) ORDER BY occurred_at DESC, event_id DESC LIMIT 101\`.
- Response: \`{ value, nextCursor }\`; cursor = base64url(\`{t, id, filtersHash}\`), optionally HMAC-signed so clients can't forge or mix cursors with different filters (return 400 if filters change).

### Consistency
- Paging backwards from the newest is stable: new events arrive "above" the first page. Clients wanting new events use a **since-cursor** (\`?before\` vs \`?after\` direction) or a streaming/webhook feed.

### Filters
- Allow-list filters that have supporting indexes (\`actor_id\`, \`action\`), or route complex queries to a search index (OpenSearch) that supports \`search_after\` cursors.

### Totals
- No exact \`COUNT(*)\` over 500M rows; provide approximate counts or counts per day from a rollup table.

### Bulk access
- For "give me everything", an **async export** job (202 + job resource) writing compressed NDJSON/Parquet to object storage — much cheaper than 10M API calls.

### Limits
- \`limit\` ≤ 1,000; rate-limit by page; ETag-less (immutable pages could even be cached by cursor).`,
      followUps: [
        {
          q: 'Users want "jump to page 500". Can you support it?',
          a: 'Not efficiently with keyset. Offer jump-by-time (e.g. "go to March 3rd") which maps to a cursor via the index, which is what users actually want in logs.',
        },
        {
          q: 'What if events can be inserted with past timestamps (late arrivals)?',
          a: 'They may land behind an already-passed cursor. Sort by ingestion sequence instead (monotonic ID) for guaranteed completeness, and expose occurred_at as a field/filter.',
        },
      ],
      pitfalls: [
        'Cursor on a non-unique column',
        'No index matching the sort',
        'Keeping COUNT(*) on every page',
      ],
    },
    {
      id: 'api-design-iq-05',
      difficulty: 'expert',
      question:
        'Clients retry POST /transfers on timeouts and you\'re seeing duplicate transfers. Design idempotency end-to-end, including concurrency, storage, expiry and what happens when your service crashes mid-request.',
      whatInterviewerLooksFor: [
        'Client-generated key semantics and scope',
        'Atomic claim with states (in-progress, completed) and replay rules',
        'Crash windows and downstream idempotency',
        'Storage sizing and expiry',
      ],
      modelAnswer: `### Contract
- Client sends \`Idempotency-Key\` (UUID) per logical transfer; retries reuse it. Scope per API account. Keys valid for 24h.

### Server algorithm
1. Hash the canonical request (method, path, body).
2. **Claim**: \`INSERT INTO idempotency_keys (account, key, hash, status='in_progress', locked_at=now())\` with PK \`(account, key)\`.
3. If insert conflicts:
   - completed & same hash → **replay** stored status+body;
   - completed & different hash → **422**;
   - in progress → **409 + Retry-After** (or wait briefly). If \`locked_at\` is older than a lease (e.g. 60 s) the previous worker likely crashed → take over (recovery path).
4. Execute the transfer **in the same DB transaction** as updating the key row to completed with the response. Ledger insert and key completion commit atomically → no "did it but didn't record it".

### Crash windows
- Crash before commit → transaction rolls back; key stays in_progress until lease expiry; retry re-executes safely.
- If the transfer calls an **external** system (bank/PSP), forward a derived idempotency key so re-execution after a crash doesn't double-send; or store a "recovery point" (Stripe's pattern: atomic phases with checkpoints) and resume from it.

### What to cache
- Final outcomes only (2xx, definitive 4xx like insufficient funds). Don't persist 5xx/timeouts as final.

### Storage
- 1,000 POST/s × 86,400 ≈ 86M keys/day × ~1 KB ≈ 86 GB/day in Postgres → **partition by day, drop old partitions** (cheap expiry), or Redis with TTL for the fast path and the DB unique constraint as the correctness guarantee.

### Also
- Business-level uniqueness (e.g. client's \`transferReference\` unique per account) as defence in depth.
- Consumers of transfer events dedupe by event ID.`,
      followUps: [
        {
          q: 'Why not use Redis SETNX for the claim?',
          a: 'Fine for fast de-duplication, but Redis is not in the same transaction as the ledger write, and async replication can lose the key on failover. Use the DB constraint for correctness; Redis only as an optimisation.',
        },
        {
          q: 'The same key arrives with a different amount. Why 422 rather than replay?',
          a: 'It signals a client bug (key reuse for a different operation); replaying the old response would hide it and could make the client believe a different transfer succeeded.',
        },
      ],
      pitfalls: [
        'In-memory or per-pod de-duplication',
        'Check-then-insert races instead of an atomic claim',
        'Caching transient errors as the idempotent result',
      ],
    },
    {
      id: 'api-design-iq-06',
      difficulty: 'hard',
      question:
        'You\'re building a new mobile app backed by 12 microservices. Teams are split between "GraphQL gateway", "a BFF in REST" and "gRPC everywhere". Make the call and write the ADR in words.',
      whatInterviewerLooksFor: [
        'Separates north-south from east-west decisions',
        'Knows GraphQL operational risks and mitigations',
        'Considers team skills, caching, tooling and client needs',
        'Uses the book\'s ADR discussion points',
      ],
      modelAnswer: `### Context
Mobile app with screens aggregating data from many services; constrained networks; frequent UI changes; 12 teams with Node/NestJS skills.

### Decision
- **East-west (service ↔ service): gRPC** for high-traffic internal calls (typed contracts, protobuf size, HTTP/2 multiplexing, deadlines); REST allowed for low-traffic internal admin APIs.
- **North-south for the mobile app: a GraphQL BFF** owned by the app team (not a company-wide graph on day one). It aggregates gRPC services, lets screens fetch exactly the fields they need in one round trip, and evolves by adding fields + deprecations instead of versions.
- **Public partner API: REST + OpenAPI** — lowest barrier, HTTP caching, familiar tooling.

### Discussion points (from the book's guideline)
- North-south vs east-west? Both exist → different answers.
- Do we control the consumer? Yes for the mobile app (enables trusted/persisted queries); no for partners (REST).
- High traffic? Internal fan-out is where volume multiplies → gRPC.
- Versioning: GraphQL schema evolves additively; proto field rules; REST major versions.

### Consequences and mitigations
- GraphQL risks: N+1 (DataLoader per request), expensive queries (**trusted documents only** from our app — no arbitrary queries; depth/cost limits as backup), caching (persisted queries over GET for public data; per-field caching), error monitoring on 200 responses.
- gRPC risks: L7 load balancing required (mesh or client round_robin), debugging binary (grpcurl, reflection in non-prod), browser access via transcoding if ever needed.
- Don't generate REST specs from protos or vice versa; design each contract for its consumer.

### Alternatives considered
- REST BFF: simpler caching, but more endpoints per screen change and over/under-fetching for mobile.
- gRPC to mobile: good performance, but weaker tooling for web, harder debugging, and proxies/CDNs less helpful.`,
      followUps: [
        {
          q: 'What if later three different apps want the same GraphQL layer?',
          a: 'Consider a federated graph (subgraphs owned by domain teams) with governance, or keep per-client BFFs if their needs diverge; avoid one team owning a monolithic gateway schema for everyone.',
        },
        {
          q: 'How do you enforce "trusted documents only"?',
          a: 'Register query hashes at build time of the app; the server accepts only known hashes (reject raw queries in production), which also enables GET caching.',
        },
      ],
      pitfalls: [
        'One protocol for all exchanges',
        'Company-wide GraphQL gateway without ownership or cost controls',
        'Ignoring gRPC load-balancing behaviour',
      ],
    },
    {
      id: 'api-design-iq-07',
      difficulty: 'medium',
      question:
        'A reporting endpoint returns a 40 MB JSON response and frequently times out at the gateway (30 s) and OOMs the pods. How would you redesign it?',
      whatInterviewerLooksFor: [
        'Recognises buffering as the root of OOM',
        'Offers pagination, streaming and async export options with trade-offs',
        'Uses compression and field selection',
        'Protects the service with limits',
      ],
      modelAnswer: `### Why it fails
- The handler loads all rows, builds one object and serialises it — memory ≈ several × 40 MB per concurrent request (rows + objects + JSON string). Ten concurrent calls → OOM.
- 40 MB over the internet takes seconds to minutes; gateways time out at 30 s.

### Options (choose by use case)
1. **Pagination** (interactive UI): keyset pages of ≤ 500 rows, field selection to send only displayed columns. Typically the UI never needed 40 MB.
2. **Streaming** (programmatic consumers who want everything, moderate size): NDJSON over HTTP using a DB cursor and stream backpressure — constant memory per request; or gRPC server streaming internally. Still bounded by gateway timeouts for very large sets.
3. **Async export** (large/whole datasets): \`POST /reports\` → **202** + \`Location: /reports/{id}\`; a worker writes gzip NDJSON/CSV/Parquet to object storage; status resource returns a **pre-signed URL** (expires in e.g. 15 min). The API server never holds the data; downloads come from S3/CDN; resumable with Range requests.

### Also
- **Compression**: JSON compresses 5–10×; 40 MB → ~5 MB with gzip/brotli.
- **Precompute** expensive aggregates (materialised views/rollups) rather than scanning raw events.
- **Limits**: max rows per sync request, per-tenant concurrency limit on report generation, cost-based rate limiting.

### Recommendation
UI uses paginated summaries; "Download full report" becomes an async export. Streaming is reserved for internal service-to-service bulk transfer.`,
      followUps: [
        {
          q: 'Why not just increase the gateway timeout and pod memory?',
          a: 'It moves the cliff: memory still scales with concurrency and dataset growth, long requests tie up connections, and retries on timeout multiply the cost.',
        },
        {
          q: 'How does the client know when an async export is done?',
          a: 'Poll the status resource with backoff (Retry-After hints) or register a webhook/notification; the status includes progress and the download link when ready.',
        },
      ],
      pitfalls: [
        'Only enabling compression',
        'Streaming while still buffering in memory',
        'Returning 200 immediately without a job resource for async work',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'api-design-boe-1',
      question:
        'A mobile product-listing endpoint serves 100K RPS with 20 KB uncompressed JSON responses. Estimate egress bandwidth, the effect of compression and field selection, and the monthly transfer volume.',
      assumptions: [
        'gzip/brotli ratio on JSON ≈ 6×',
        'Field selection trims the payload to 40% of the original fields',
        '30-day month, average traffic 40% of peak',
      ],
      steps: [
        { label: 'Raw peak egress', calc: '100K × 20 KB = 2 GB/s ≈ 16 Gbps' },
        { label: 'With compression', calc: '2 GB/s ÷ 6 ≈ 333 MB/s ≈ 2.7 Gbps' },
        { label: 'With field selection + compression', calc: '333 MB/s × 0.4 ≈ 133 MB/s ≈ 1.1 Gbps' },
        { label: 'Monthly volume (avg 40% of peak)', calc: '133 MB/s × 0.4 × 2.6M s ≈ 138 TB/month (vs ~2 PB raw)' },
      ],
      answer:
        'About 16 Gbps raw at peak, ~2.7 Gbps compressed, ~1.1 Gbps with field selection too; about 140 TB/month instead of roughly 2 PB.',
      insight:
        'Payload design (compression, sparse fields, summary representations) is a 10×+ lever on cost and mobile latency. It is often cheaper than any server-side optimisation.',
      followUps: [
        {
          "q": "CDN egress costs about $0.02/GB. What's the monthly bill before and after the optimisations, and which assumption would you challenge first?",
          "a": "Raw ~2 PB × $0.02 ≈ $40K/month; optimised ~138 TB ≈ $2.8K/month. Challenge the 6× compression ratio first: it holds for repetitive JSON, but if responses include base64 images or already-short payloads it can drop to 2–3×, which would double or triple the bill. Measure it on a real sample of responses. Next, check the 40% average-to-peak ratio. A spiky consumer app may average 25%, which helps, while a global app with flat traffic may be at 60%."
        },
        {
          "q": "Mobile clients on 3G (~1 Mbps effective) need the screen in under 1 s. Does the optimised payload meet that?",
          "a": "Optimised payload: 20 KB × 0.4 ÷ 6 ≈ 1.3 KB per response, which is about 11 ms of transfer at 1 Mbps. The payload isn't the problem any more. Round trips are: DNS + TCP + TLS on a cold 3G connection can be 3–4 RTTs × 300 ms ≈ 1 s on their own. So reuse connections (HTTP/2 keep-alive), use TLS 1.3 or 0-RTT resumption, serve from an edge PoP close to the user, and avoid chained requests (one call per screen, not five)."
        }
      ],
    },
    {
      id: 'api-design-boe-2',
      question:
        'A partner exports 20 million orders through GET /orders?offset=…&limit=100. Estimate total rows the database reads with offset vs keyset pagination.',
      assumptions: [
        '20M rows, 100 rows per page → 200,000 pages',
        'Offset page k reads (k × 100 + 100) index entries/rows',
        'Keyset page reads ~100 rows (plus a small index seek)',
      ],
      steps: [
        { label: 'Offset total reads', calc: 'Σ 100k for k = 1..200,000 ≈ 100 × 200,000² ÷ 2 = 2 × 10^12 rows' },
        { label: 'Keyset total reads', calc: '200,000 × 100 = 2 × 10^7 rows' },
        { label: 'Ratio', calc: '2 × 10^12 ÷ 2 × 10^7 = 100,000× more work with offset' },
        { label: 'Last offset page alone', calc: 'reads ~20M rows → seconds per request at ~10M rows/s' },
      ],
      answer:
        'Offset pagination reads about 2 trillion rows over the full export (the last pages alone read ~20M each); keyset reads about 20 million, 100,000× less.',
      insight:
        'Offset cost is quadratic over a full scan. Any endpoint that can be crawled end to end must use keyset pagination, and full exports should become async bulk jobs.',
      followUps: [
        {
          "q": "The partner insists on 'page N' semantics because their tool is built around it. Can you give them that cheaply?",
          "a": "Provide a bulk export instead: `POST /orders/exports` produces NDJSON files of 1M rows each in object storage, so 'page N' becomes 'file N'. Internally, the export streams by keyset in one pass (20M row reads), not 200,000 offset queries. If they truly need `?page=N` against live data, cap `page × limit` (for example at 10,000 rows, as many search APIs do) and point them to the export for anything deeper. Offset is fine for shallow pages and lethal for full crawls."
        },
        {
          "q": "Ten partners run the full export concurrently every night with keyset. Is the database OK?",
          "a": "Keyset reads are 10 × 20M = 200M rows. At roughly 100 rows per index seek and ~1–2 ms per page, each partner needs about 200K pages × 1.5 ms ≈ 5 min of DB time, fine sequentially. The risks are concurrency and cache pollution: 10 full scans evict hot pages from the buffer cache and hurt daytime traffic if it overlaps. Run exports against a read replica, rate-limit per partner (for example 20 pages/s), or precompute one nightly snapshot export and serve the same files to everyone."
        }
      ],
    },
    {
      id: 'api-design-boe-3',
      question:
        'A retail partner pushes 2 million inventory updates every night. Today it calls PUT /inventory/{sku} once per item; you are proposing POST /inventory:batch with up to 500 items per call. Estimate the sync time for both designs, and how much gets re-sent when 0.2% of items fail validation.',
      assumptions: [
        'Partner-to-API round trip 40 ms; single-item server time ~10 ms; the partner runs 8 concurrent connections',
        'Batch call: 40 ms RTT + ~150 ms for a 500-row multi-row upsert + 150 KB body (500 × 300 B) at ~50 Mbps ≈ 24 ms',
        'Per-partner rate limit: 100 requests/s',
        'Item failures are independent, at 0.2% per item',
      ],
      steps: [
        { label: 'Single-item throughput', calc: '8 connections ÷ (40 + 10 ms) = 160 req/s, but the rate limit caps it at 100 req/s' },
        { label: 'Single-item sync time', calc: '2,000,000 ÷ 100 req/s = 20,000 s ≈ 5.6 h (≈ 3.5 h even without the limit)' },
        { label: 'Batch count', calc: '2,000,000 ÷ 500 = 4,000 requests' },
        { label: 'Batch sync time', calc: '40 + 150 + 24 ≈ 214 ms per call → 8 ÷ 0.214 ≈ 37 req/s → 4,000 ÷ 37 ≈ 107 s ≈ 2 min' },
        { label: 'Failed items', calc: '2,000,000 × 0.002 = 4,000 items' },
        { label: 'Batches with at least one failure', calc: '1 − 0.998^500 ≈ 1 − e^−1 ≈ 63% → ~2,530 of 4,000 batches' },
        { label: 'Re-sent with all-or-nothing batches', calc: '~2,530 × 500 ≈ 1.26M items re-sent, and each retry fails again until the bad item is removed' },
        { label: 'Re-sent with per-item results', calc: '4,000 items (0.2%), in 8 batch calls' },
      ],
      answer:
        'About 5.6 hours per night item by item (rate-limit bound) vs about 2 minutes with 500-item batches. With 0.2% bad items, about 63% of batches contain a failure: all-or-nothing semantics would re-send ~1.26M items, while per-item results re-send only the 4,000 that failed.',
      insight:
        'Batching removes the round-trip and rate-limit bottleneck (a ~190× speed-up here), but only if partial failure is part of the contract. Return a per-item status array (or 207 Multi-Status) keyed by a client-supplied item id, make each item idempotent, and document that a batch is not a transaction. At 500 items and a 0.2% error rate, only about a third of atomic batches would succeed on the first try.',
      followUps: [
        {
          "q": "The partner's network is fine but your upsert of 500 rows takes 1.5 s instead of 150 ms under load. What's the new sync time, and where do you look?",
          "a": "Per call ≈ 40 + 1,500 + 24 ≈ 1.56 s, so 8 connections give ~5 req/s and 4,000 batches take about 800 s ≈ 13 min. Still far better than 5.6 h. Look at the DB: lock waits on hot SKUs shared with daytime writes, index count on the inventory table (each upsert updates every index), and trigger work. Sort the 500 rows by SKU before the upsert to reduce deadlocks, and consider staging into an unlogged table, then `INSERT ... SELECT ... ON CONFLICT` in one statement."
        },
        {
          "q": "The partner wants to send 50,000 items per batch to make it even faster. What do you say?",
          "a": "Speed barely improves: past a few hundred rows, per-call RTT overhead is already amortised, and server time scales linearly with rows. Meanwhile, risk grows: the body becomes ~15 MB, one transaction holds row locks for seconds, a timeout loses the whole call, and with a 0.2% error rate essentially every batch contains a failure (1 − 0.998^50000 ≈ 100%). Keep the max at 500–1,000. For bigger loads, offer an async bulk job: upload a file, the server processes it in chunks, and the client polls for per-item results."
        }
      ],
    },
  ],
  test: [
    {
      id: 'api-design-mcq-01',
      difficulty: 'hard',
      question:
        'A client sends PATCH /accounts/42 with body {"op":"increment","path":"/credits","value":10} and times out. It retries. Which statement is correct?',
      options: [
        'This PATCH is not idempotent; the retry may add 20 credits unless the server uses an idempotency key or a precondition (If-Match)',
        'PATCH is idempotent by definition, so the retry is safe',
        'The server should return 304 Not Modified on the retry',
        'HTTP guarantees at-most-once delivery for PATCH',
      ],
      correct: [0],
      explanation:
        'PATCH is neither safe nor idempotent by definition; an increment operation applied twice changes the state twice. An idempotency key or If-Match with the version read before the first attempt (the retry would then get 412) makes it safe. 304 applies to conditional GETs, and HTTP gives no delivery guarantees.',
      followUps: [
        {
          "q": "You can't change the mobile client to send an Idempotency-Key. How else can you make this credit increment retry-safe on the server side?",
          "a": "Change the shape of the operation rather than the transport. Either make it absolute (`PUT /accounts/42/credits` with the target value plus `If-Match` on the version the client read, so a retry gets 412 instead of double-adding), or turn the increment into a resource: `POST /accounts/42/credit-grants` with a client-generated grant id in the body, stored under a unique constraint so a replay hits `ON CONFLICT DO NOTHING`. Both move dedupe into a database constraint instead of trusting the network."
        },
        {
          "q": "With If-Match, the retry gets 412 — but the first attempt actually succeeded. How does the client tell 'my write landed' from 'someone else wrote'?",
          "a": "A bare 412 is ambiguous, so the client re-GETs the resource and compares. If the new version is exactly old+1 and the credits equal what it intended, its own write landed and it can stop. Anything else means a concurrent writer, so it must merge. To make this deterministic, record a `lastOperationId` (client-supplied) on the resource or in an operations log, so the client can check whether its operation id is already applied without guessing from values."
        }
      ],
    },
    {
      id: 'api-design-mcq-02',
      difficulty: 'expert',
      question: 'What bugs does this keyset pagination query have? Select ALL that apply.',
      code: {
        language: 'sql',
        code: `-- cursor = last row's created_at
SELECT id, created_at, total
FROM orders
WHERE account_id = $1 AND created_at < $2
ORDER BY created_at DESC
LIMIT 50;
-- index: (account_id, id)`,
      },
      options: [
        'Rows sharing the same created_at as the cursor row can be skipped at page boundaries',
        'The available index does not match the filter+sort, so the DB may scan and sort many rows',
        'Keyset pagination cannot be used with DESC ordering',
        'Rows with identical created_at may appear in a non-deterministic order across pages',
        'LIMIT 50 makes the query O(n²)',
      ],
      correct: [0, 1, 3],
      explanation:
        'Without a unique tiebreaker (id) in both the ORDER BY and the row-value comparison, ties at the boundary are skipped and ordering among ties is unstable. The index (account_id, id) doesn\'t serve ORDER BY created_at; use (account_id, created_at DESC, id DESC). Keyset works fine with DESC, and LIMIT doesn\'t make it quadratic.',
      followUps: [
        {
          "q": "You fix it to `(created_at, id) < ($2, $3)` with index `(account_id, created_at DESC, id DESC)`. Now product wants a 'sort by total' option. What changes in the cursor and indexing?",
          "a": "The cursor must encode the sort key plus the tiebreaker: `{sort:'total', v: total, id}`, and the predicate becomes `(total, id) < ($v, $id)`. You need a second index `(account_id, total DESC, id DESC)` for it to stay a seek. Each extra sort option costs one index and write amplification, so offer a small fixed set. Put the sort name inside the opaque cursor and reject a cursor reused with a different `sort` parameter (400), because positions aren't portable between orderings."
        },
        {
          "q": "How would you write a test that proves the boundary bug is fixed?",
          "a": "Seed an account with rows where many share the same `created_at`, for example 120 rows with 3 distinct timestamps, so ties span page boundaries at limit 50. Walk the pages through the API until `nextCursor` is null and assert that the concatenated ids equal the full set exactly: no duplicates, no gaps, strictly ordered by `(created_at, id)`. Add a property-based variant that inserts new rows between page fetches and asserts that no previously visible row is skipped. Run `EXPLAIN` in the test to assert an Index Scan and no Sort node."
        }
      ],
    },
    {
      id: 'api-design-mcq-03',
      difficulty: 'hard',
      question:
        'Two admins load order v7 and both submit edits. Your API uses ETags and If-Match. What does the second writer receive, and what should it do?',
      options: [
        '200 OK — last write wins, which is the HTTP default',
        '409 Conflict — HTTP requires 409 for version mismatches',
        '304 Not Modified — nothing changed from its point of view',
        '412 Precondition Failed — re-fetch the current version, merge, and retry with the new ETag',
      ],
      correct: [3],
      explanation:
        'If-Match "7" fails because the resource is now v8, so the server returns 412 and the client must re-read and reconcile — optimistic concurrency without locks. Last-write-wins is what happens without preconditions (the lost-update bug). 409 is used for other state conflicts, and 304 is for conditional GETs.',
      followUps: [
        {
          "q": "Two admins collide on the same order dozens of times a day and keep getting 412s. How do you reduce conflicts without falling back to last-write-wins?",
          "a": "Narrow what a conflict means. Version sub-resources separately (shipping address, notes, line items) so edits to different parts don't collide, or accept field-level JSON Merge Patch and only reject when the same field changed since the client's version (the server keeps the previous field values or a change log to compare). For truly hot records, add a soft edit lock with presence ('Priya is editing'), with a short lease of 2 minutes, as UX on top of the ETag check, never instead of it."
        },
        {
          "q": "The client UI shows a 412. What should the response body contain so the UI can offer a useful merge?",
          "a": "Return an RFC 9457 problem with a stable type such as `/problems/version-conflict`, the current ETag and, ideally, the current representation or a diff of fields changed since the client's version. The UI can then show 'Status was changed to Shipped by Priya' and let the admin reapply their edit on top, then retry with the new ETag. Don't put the whole object in the body if it contains fields the caller isn't authorized to see; filter it the same way GET does."
        }
      ],
    },
    {
      id: 'api-design-mcq-04',
      difficulty: 'expert',
      question: 'A GraphQL query for 100 posts with their authors issues 101 SQL queries. The team adds DataLoader like this. What is the remaining problem?',
      code: {
        language: 'typescript',
        code: `// module scope, created once at startup
const userLoader = new DataLoader(async (ids: readonly string[]) => {
  const rows = await db.query('SELECT * FROM users WHERE id = ANY($1)', [ids]);
  return rows.rows; // returned in DB order
});

const resolvers = { Post: { author: (p) => userLoader.load(p.authorId) } };`,
      },
      options: [
        'DataLoader cannot batch Postgres queries',
        'ANY($1) is slower than 100 separate queries',
        'Results must be returned in the same order and length as ids, and a module-level loader caches users across requests and users (stale data and data leakage)',
        'The loader should be awaited in the resolver to enable batching',
      ],
      correct: [2],
      explanation:
        'DataLoader maps results by position, so returning rows in DB order (possibly with missing rows) assigns wrong authors; you must map by id. Its memoisation cache is meant to be per request; a global instance serves stale data and can leak authorised data between users. Batching works fine with ANY($1), and returning the promise is enough for batching.',
      followUps: [
        {
          "q": "Fix the batch function. What exactly must it return when two of the 100 requested author ids no longer exist?",
          "a": "Build a map and project the input order: `const byId = new Map(rows.map(r => [r.id, r])); return ids.map(id => byId.get(id) ?? null);`, or return `new Error('not found')` for that slot if a missing author should surface as a field error. The array must have length 100 and position i must correspond to `ids[i]`. Otherwise DataLoader rejects the whole batch with a length mismatch, or worse, silently misassigns authors. Create the loader in the per-request context factory."
        },
        {
          "q": "Now the query is posts → comments → comment authors, 100 posts × 20 comments. How many SQL queries run with per-request loaders, and what's left to worry about?",
          "a": "About 3 queries: posts, one batched comments-by-post-id, and one batched users-by-id for all ~2,000 comment authors, because DataLoader batches per tick at each level of the tree. The remaining risks are size, not count: an `ANY($1)` with 2,000 ids returns a big result set, and a 50-level nested query could still explode. Set `maxBatchSize` (for example 500), enforce depth and cost limits, and paginate `comments(first: 20)` so that the fan-out is bounded by the schema."
        }
      ],
    },
    {
      id: 'api-design-mcq-05',
      difficulty: 'medium',
      question:
        'POST /exports starts a 10-minute job. What is the most appropriate response?',
      options: [
        '202 Accepted with Location pointing to a status resource (e.g. /exports/{id}) that later provides a download link',
        '200 OK after the job finishes, with the file in the body',
        '201 Created with an empty body',
        '204 No Content, and email the file',
      ],
      correct: [0],
      explanation:
        '202 signals accepted-but-not-completed, and a status resource lets the client poll (or get a webhook) and then download from object storage. Holding the request open for 10 minutes hits gateway timeouts; 201 implies the resource is ready now; 204 gives the client nothing to track.',
      followUps: [
        {
          "q": "The client polls GET /exports/{id} every second. With 50K concurrent exports, that's 50K RPS of polling. How do you cut it down?",
          "a": "Return `Retry-After: 30` (or an ETA based on progress) on the status resource, and have SDKs honour it with backoff. Make the status GET cheap: serve it from Redis or a cached row, never by querying the job system. Offer a webhook (`export.completed`) or a server-sent events stream for clients that can receive them. Optionally let GET support long-polling (`?wait=20s`), holding the request until the state changes. Together these usually cut polling by 10–30×."
        },
        {
          "q": "The worker crashes at 80% through the export. What does the client see, and what should the job design guarantee?",
          "a": "The status resource should never stay 'running' forever. Workers hold a lease or heartbeat on the job row, and a sweeper requeues jobs whose lease expired, with an attempt counter (for example max 3, then status `failed` with a problem body). Write output to object storage via multipart upload or chunked files so a retry can resume from a checkpoint (the last exported cursor) rather than starting over. The client sees `running` with progress continuing, or eventually `failed` and can POST a new export."
        }
      ],
    },
    {
      id: 'api-design-mcq-06',
      difficulty: 'hard',
      question: 'Which issues does this error response have for an external API? Select ALL that apply.',
      code: {
        language: 'json',
        code: `HTTP/1.1 200 OK
Content-Type: application/json

{ "success": false,
  "error": "duplicate key value violates unique constraint \\"users_email_key\\"",
  "stack": "at UsersRepo.insert (/app/src/users.repo.ts:41:11) ..." }`,
      },
      options: [
        'Returning 200 for an error defeats client error handling, monitoring and retries',
        'It leaks internal details (SQL constraint names, file paths, stack traces)',
        'It should be 409 (or 422) with a stable, documented problem type instead of a raw DB message',
        'JSON is not allowed in error responses; errors must be plain text',
      ],
      correct: [0, 1, 2],
      explanation:
        'Errors belong in the status code (409 for a duplicate/conflicting resource, or 422 for validation) with an RFC 9457 body whose type URI clients can branch on. Stack traces and constraint names help attackers and couple clients to internals. JSON error bodies are standard (application/problem+json).',
      followUps: [
        {
          "q": "You switch to 409 with a problem+json body. Should the response say 'that email is already registered'?",
          "a": "For a public signup endpoint, revealing that an email exists enables account enumeration. Safer: return the same 202 'check your inbox' response either way and email the existing owner a 'someone tried to sign up' notice. For authenticated or admin APIs (an admin creating a user in their own tenant) a specific 409 with `type: /problems/email-taken` and the field name is fine and helpful. Decide per endpoint based on who the caller is, and rate-limit either way."
        },
        {
          "q": "How do you make sure stack traces never leak again, across 40 services written by different teams?",
          "a": "Centralise it: a shared error middleware in the service template maps known domain errors to problem types and turns everything else into a generic 500 `{type: about:blank, title: 'Internal error', traceId}`. The stack goes to logs keyed by `traceId`, never into the body. Back it with a gateway response filter that strips `stack` and `trace` fields, plus a contract test or an OpenAPI linter that fails CI if an error schema isn't `application/problem+json`. Fuzz endpoints in staging and alert on 5xx bodies matching `at .*\\.ts:`."
        }
      ],
    },
    {
      id: 'api-design-mcq-07',
      difficulty: 'expert',
      question:
        'A client retries POST /payments with the same Idempotency-Key while the first request is still being processed (a slow PSP call). What should a correct implementation do?',
      options: [
        'Process the second request too; the PSP will reject one of them',
        'Wait indefinitely for the first to finish, then return its result',
        'Return the cached result from a previous day with the same key',
        'Return 409 Conflict (optionally with Retry-After) because the key is in progress; never execute concurrently',
      ],
      correct: [3],
      explanation:
        'The key is claimed and in progress; executing again risks a double charge and waiting indefinitely ties up resources. Returning 409 (Stripe\'s behaviour) lets the client retry shortly and get the replayed result. Keys expire (e.g. 24h), and relying on the PSP alone ignores your own side effects.',
      followUps: [
        {
          "q": "The first request's pod dies after claiming the key but before the PSP call. The client retries forever and keeps getting 409. How do you fix this?",
          "a": "Give the claim a lease: store `locked_until = now() + 30s` (longer than the PSP timeout) with the in-progress row. A retry that finds an expired lock may take over atomically with `UPDATE ... SET locked_until = now()+30s WHERE key=$1 AND status='in_progress' AND locked_until < now()`. Exactly one retry wins. That takeover is only safe because the PSP call itself uses the same idempotency key, so if the dead pod did reach the PSP, the new attempt gets the original charge back instead of charging twice."
        },
        {
          "q": "How would you test the concurrent-duplicate behaviour before shipping?",
          "a": "Write an integration test against a real Postgres that fires 20 identical POSTs with the same key in parallel (Promise.all, with a stub PSP that sleeps 500 ms). Assert exactly one PSP call, one 201, the rest 409 (or 201 replays after completion), and one row in `payments`. Add a fault-injection case: kill the handler after the claim (throw after the INSERT) and assert a retry after the lease expires completes once. Run it in CI across 2 app instances to catch any per-process state."
        }
      ],
    },
    {
      id: 'api-design-mcq-08',
      difficulty: 'hard',
      question:
        'An internal gRPC service has 10 client pods and 30 server pods behind a Kubernetes ClusterIP Service. Server CPU shows 10 pods at 90% and 20 nearly idle. Most likely cause?',
      options: [
        'Protobuf decoding is CPU-heavy on some pods',
        'HTTP/2 long-lived connections are balanced once at connect time by kube-proxy (L4), so each client pins its calls to a few servers',
        'gRPC always sends requests to the lowest pod IP',
        'The Service needs sessionAffinity: ClientIP',
      ],
      correct: [1],
      explanation:
        'ClusterIP load-balances connections, not requests; gRPC multiplexes all calls over a few long-lived HTTP/2 connections, so load follows connections. Use client-side load balancing (headless Service + round_robin) or an L7 proxy/mesh. Decoding is uniform; there is no lowest-IP rule; ClientIP affinity makes pinning worse.',
      followUps: [
        {
          "q": "You switch to a headless Service with client-side round_robin. Then the servers scale from 30 to 60 pods. Do clients use the new pods?",
          "a": "Not necessarily right away. gRPC's DNS resolver re-resolves only on connection failures or its own min interval (around 30 s in many implementations), so new pods can sit idle. Fix it on the server: set `MAX_CONNECTION_AGE` (for example 5 min, with a grace period) so the server sends GOAWAY periodically, forcing clients to re-resolve and reconnect to the new set. Alternatively use xDS or a service mesh for push-based endpoint updates. Watch per-pod RPS skew during autoscaling events."
        },
        {
          "q": "How would you have detected this imbalance before CPU alarms fired?",
          "a": "Emit per-pod server metrics (`grpc_server_handled_total` by pod) and graph the coefficient of variation or max/mean RPS ratio across replicas, alerting when one pod gets more than 2× the mean. On the client side, track the number of open subchannels per client. If each client has 1 connection to a 30-pod service, that's the smoking gun. A load test with fewer clients than servers (10 vs 30, like production) reproduces it; tests with hundreds of short-lived clients hide it."
        }
      ],
    },
    {
      id: 'api-design-mcq-09',
      difficulty: 'medium',
      question:
        'Your v1 API returns GET /attendees as a bare JSON array. You now need pagination links. What is the least disruptive path?',
      options: [
        'Change the response to an object with value and nextLink — clients will adapt',
        'Pagination cannot be added to an existing endpoint',
        'Return the next link as the last element of the array',
        'Add a Link header (RFC 8288) with rel="next" and keep the array body, or introduce the object shape in a new major version',
      ],
      correct: [3],
      explanation:
        'Changing the body from array to object breaks every client (Mastering API Architecture\'s example of why to start with an envelope). A Link header adds pagination without changing the body; otherwise ship the envelope in v2. Mixing a link into the array corrupts the data type.',
      followUps: [
        {
          "q": "You ship v2 with the envelope. Many v1 clients never upgrade. How do you get them off v1 within 12 months?",
          "a": "Measure first: log usage per API key or client per version so you know who is still on v1. Announce the deprecation with `Deprecation` and `Sunset` response headers plus emails to the owners of active keys, and publish a migration guide. Ramp pressure gradually: brownouts (v1 returns 410 for 1 hour, then 1 day) a few months before the sunset date flush out forgotten integrations. Keep v1 as a thin adapter over v2's implementation so you only maintain one code path while it lives."
        },
        {
          "q": "Some clients follow the Link header's next URL blindly. What must you guarantee about that URL?",
          "a": "Treat it as an opaque, stable contract. It should be absolute or correctly relative, carry the same filters and sort as the original request, and embed an opaque cursor rather than an offset so it stays correct as data changes. It must survive the client storing it for minutes. Never include secrets or auth tokens in it, since it ends up in logs. If the cursor expires or becomes invalid, return 400 with a problem type that tells the client to restart from the first page."
        }
      ],
    },
    {
      id: 'api-design-mcq-10',
      difficulty: 'expert',
      question:
        'Which measures specifically mitigate expensive or abusive GraphQL queries? Select ALL that apply.',
      options: [
        'Query depth limits and cost/complexity analysis with a per-request budget',
        'Trusted documents (persisted query allow-list) for first-party clients',
        'Switching every operation from POST to GET so the CDN absorbs expensive queries',
        'Returning HTTP 500 for any query over 10 fields',
        'Rate limiting by computed query cost rather than by request count',
      ],
      correct: [0, 1, 4],
      explanation:
        'Depth/cost limits, allow-listed documents and cost-based rate limiting all bound the work a single request can cause. GET only helps caching for repeatable (persisted) queries — an attacker varies variables or query text and every request still hits origin. A blanket "more than 10 fields" cutoff with 500 is arbitrary (field count isn\'t cost) and misuses a server-error status for a client problem.',
      followUps: [
        {
          "q": "You set a cost budget of 1,000 points per query. How do you choose the per-field costs and the limit without breaking existing clients?",
          "a": "Derive costs from data: assign 1 per scalar object, and for list fields multiply by the requested `first` argument (or a default max, for example 100). Then replay a week of production query logs through the cost calculator in shadow mode and plot the distribution. Set the limit above the p99.9 of legitimate first-party traffic and log (don't reject) anything over it for two weeks. Talk to the owners of the outliers, then enforce. Return the computed cost in `extensions` so clients can see how close they are."
        },
        {
          "q": "An attacker sends many cheap queries instead of one expensive one. Which of these defences still helps?",
          "a": "Cost-based rate limiting is what helps here: each client has a points budget per minute (for example 10,000), and every query, cheap or not, debits its computed cost. Many cheap queries drain the bucket just like one expensive one. Depth limits don't help against a flood of shallow queries. For anonymous traffic, also key the limiter by IP or device and require trusted documents, so the attacker can only run your persisted queries, whose costs you already know."
        }
      ],
    },
    {
      id: 'api-design-mcq-11',
      difficulty: 'hard',
      question:
        'A gRPC client calls service A with a 200 ms deadline; A calls B. B takes 500 ms. A\'s code calls B without passing any deadline. What happens?',
      options: [
        'The client gets DEADLINE_EXCEEDED at ~200 ms, but A keeps waiting on B (no deadline) and B keeps working — wasted work unless A propagates the deadline or cancellation',
        'B automatically inherits the 200 ms deadline because gRPC propagates deadlines implicitly in all languages',
        'A\'s call to B fails immediately because no deadline was set',
        'The client waits 500 ms and gets a success',
      ],
      correct: [0],
      explanation:
        'Deadlines are sent on the wire, but propagation to child calls is explicit in most implementations (in Node you pass the deadline or use the parent call for propagation); a missing deadline means "wait forever". The client times out at 200 ms while A and B continue. No deadline doesn\'t fail the call, and the client never waits past its own deadline.',
      followUps: [
        {
          "q": "You propagate the deadline from A to B. B now gets about 180 ms remaining. B calls C and D in sequence. How should B budget them?",
          "a": "B passes the remaining deadline (not a fresh 200 ms) on each call, so C and D share what's left. If C uses 150 ms, D gets ~30 ms and should fail fast rather than start. Good practice is to check `remaining < expected minimum latency` and return DEADLINE_EXCEEDED immediately, saving the work. For the parallel case, give both the full remaining budget. Also reserve a few ms of headroom for B's own serialization so the response gets back before the caller gives up."
        },
        {
          "q": "How do you find, in production, services that call downstreams without deadlines?",
          "a": "Use tracing: spans for outbound gRPC calls record the `grpc-timeout` header, so you can query for client spans with no deadline or one longer than the parent's. Add a client interceptor in the shared library that logs or emits a metric (`rpc_without_deadline_total`) and, after a grace period, injects a default deadline (for example 1 s) when none is set. Then look for server spans that keep running after the caller's span ended. Those are wasted work and show up clearly in trace waterfalls."
        }
      ],
    },
    {
      id: 'api-design-mcq-12',
      difficulty: 'expert',
      question: 'This handler serves ETags for caching and concurrency. What is wrong?',
      code: {
        language: 'typescript',
        code: `app.get('/docs/:id', (req, res) => {
  const doc = repo.get(req.params.id);
  res.set('ETag', 'W/"' + doc.version + '"');
  if (req.get('If-None-Match') === res.get('ETag')) return res.status(304).end();
  res.json(doc);
});
app.put('/docs/:id', (req, res) => {
  if (req.get('If-Match') !== 'W/"' + repo.get(req.params.id).version + '"') return res.status(412).end();
  repo.save(req.params.id, req.body);          // read-check-write in app code
  res.status(204).end();
});`,
      },
      options: [
        'Nothing; weak ETags are fine for both uses',
        'A 304 response must include the full body',
        'Weak ETags must not be used with If-Match (strong comparison), and the check-then-save is racy — the version check must be atomic in the write (WHERE version = ?)',
        'PUT must return 200, never 204',
      ],
      correct: [2],
      explanation:
        'RFC 9110 requires strong comparison for If-Match, so weak ETags never match there; use strong ETags for concurrency control. Separately, two requests can both pass the check before either saves — the version comparison belongs in an atomic conditional UPDATE. 304 has no body and 204 is a valid PUT response.',
      followUps: [
        {
          "q": "Write the atomic version of the PUT so two concurrent requests can't both pass the check.",
          "a": "Push the check into the write: `UPDATE docs SET body=$1, version=version+1 WHERE id=$2 AND version=$3 RETURNING version`, with `$3` parsed from the strong ETag `\"7\"`. If `rowCount === 0`, look up whether the doc exists: if it doesn't, return 404, otherwise return 412. On success, set the new strong ETag from the returned version and send 204 (or 200 with the body). The database's row lock guarantees that only one of the two concurrent updates matches `version=7`."
        },
        {
          "q": "The GET is served through a CDN. What changes in the ETag and caching design?",
          "a": "The CDN can revalidate with `If-None-Match` on your behalf, so make the ETag cheap to compute (from `version`, without loading the full doc) and set `Cache-Control: public, max-age=60` or `no-cache` to force revalidation. If responses vary by user or permissions, the CDN must not share them: use `private` or key by auth. Make sure gzip at the CDN doesn't change a strong ETag silently. Some CDNs weaken it to `W/`, which is fine for GET caching but means the client must not reuse the cached ETag for If-Match."
        }
      ],
    },
    {
      id: 'api-design-mcq-13',
      difficulty: 'hard',
      question:
        'A bulk endpoint receives 500 items; 3 fail validation. Product wants partner integrations to be simple and retry-safe. Which design is best? Select ALL that apply.',
      options: [
        'Return per-item results (with a client ref per item) and a summary, using a documented status such as 200 or 207',
        'Require a per-item or batch idempotency key so resubmitting the batch doesn\'t duplicate the 497 successes',
        'Return 500 so the partner retries the whole batch',
        'Silently drop invalid items and return 200 with only the successes',
      ],
      correct: [0, 1],
      explanation:
        'Per-item results tell the partner exactly what failed, and idempotency makes resubmission safe. A 500 invites blind retries that duplicate the successes and misreports a client error as a server fault; silently dropping items loses data without anyone noticing.',
      followUps: [
        {
          "q": "The partner wants all-or-nothing semantics for one type of batch (a price list must apply atomically). How do you offer that without breaking the default?",
          "a": "Make it an explicit opt-in: `POST /prices:batch?atomic=true` or a separate `price-lists` resource where the whole list is one versioned document. In atomic mode, validate everything first and return 422 with per-item errors and no writes if anything fails. Then apply it in one transaction, or stage the list and flip a pointer to the new version, which works for large lists. Cap atomic batches smaller (for example 5,000 rows) because one long transaction holds locks and bloats WAL."
        },
        {
          "q": "The batch endpoint takes 500 items. A partner sends 500 items each with a 1 MB attachment. What breaks and how do you bound it?",
          "a": "A 500 MB request body ties up a worker, may OOM the pod if it's buffered, and blows past gateway limits (often 10–100 MB) and timeouts. Bound both count and bytes: enforce a max body size (for example 5 MB) at the gateway and return 413. Move large blobs out of band: the client uploads to object storage via presigned URLs and the batch carries only references. Stream-parse the JSON if you must accept large bodies, so memory doesn't scale with batch size."
        }
      ],
    },
    {
      id: 'api-design-mcq-14',
      difficulty: 'expert',
      question:
        'A team generates their .proto file from the OpenAPI spec with a tool that orders fields alphabetically and numbers them 1..n. They add a new field "age" to the Attendee schema. What happens to existing gRPC clients?',
      options: [
        'Nothing; adding a field is always backward compatible',
        'gRPC renegotiates field numbers at connection time',
        'Old clients reject the message because of an unknown field',
        'Field numbers of fields sorting after "age" shift, so old clients decode values into the wrong fields — a silent wire-level break',
      ],
      correct: [3],
      explanation:
        'Protobuf identifies fields by number; renumbering existing fields means old binaries interpret bytes as different fields (Mastering API Architecture\'s openapi2proto warning). Adding a field with a new number is compatible, and unknown fields are ignored, not rejected. There is no runtime negotiation of numbers.',
      followUps: [
        {
          "q": "The bad version already shipped and some clients have decoded garbage. How do you recover?",
          "a": "Revert the .proto immediately to the original numbering, since numbers are the wire contract, and redeploy servers first. Add `age` with the next unused number. Data written by the bad version may be corrupt: identify the window from deploy times, and if messages were persisted (Kafka, DB blobs), replay or re-derive them from source. Then add `buf breaking` to CI against the main branch so a renumbering, type change or reuse of a field number fails the build."
        },
        {
          "q": "Later you delete the `nickname` field from Attendee. What must you do in the .proto so this can never bite you again?",
          "a": "Don't just remove the line. Add `reserved 7; reserved \"nickname\";` with the old number and name. That stops anyone reusing number 7 for a new field with a different type, which old clients would misinterpret. It also stops JSON or text-format collisions on the name. Old clients that still send field 7 are fine: new servers treat it as an unknown field and preserve or ignore it. Deprecate first (`[deprecated = true]`) and only reserve after usage drops to zero."
        }
      ],
    },
    {
      id: 'api-design-mcq-15',
      difficulty: 'medium',
      question:
        'For which exchange is gRPC the most natural fit according to the modeling-exchanges guideline?',
      options: [
        'A high-traffic east-west call between two services whose producer controls both sides',
        'A public API consumed by thousands of third-party developers from browsers',
        'A marketing site\'s content API served through a CDN',
        'A webhook delivered to customer endpoints',
      ],
      correct: [0],
      explanation:
        'The guideline recommends gRPC when the producer controls both services or the service is proven to be high-traffic, where binary encoding and HTTP/2 multiplexing pay off. Public/browser consumers favour REST (low barrier, loose coupling), CDN-cached content benefits from HTTP caching semantics, and webhooks must be plain HTTP that any customer can receive.',
      followUps: [
        {
          "q": "Your gRPC east-west service now has to be exposed to a browser-based admin console. What do you do?",
          "a": "Don't rewrite it. Put a translation layer at the edge: gRPC-Web via Envoy (the browser speaks gRPC-Web over HTTP/1.1 or 2, and Envoy translates), or generate a REST/JSON facade with grpc-gateway using `google.api.http` annotations in the proto. Connect-RPC is another option if you want one handler serving gRPC, gRPC-Web and JSON. Keep internal-only methods out of the exposed surface by allow-listing routes at the gateway, and add normal edge auth there."
        },
        {
          "q": "Two internal services talk gRPC at 50K RPS. The team proposes switching to REST/JSON for easier debugging. What do you ask before agreeing?",
          "a": "Measure the cost: JSON encoding of the same payload is typically 2–5× bigger and costs noticeably more CPU at 50K RPS, plus you lose HTTP/2 multiplexing unless the REST stack enables it. Ask what the debugging pain actually is. Usually tools fix it: grpcurl, server reflection, a protobuf-aware logging interceptor and tracing. Also ask about the contract: protobuf with `buf breaking` gives you enforced compatibility that a REST stack would have to rebuild with OpenAPI diffs."
        }
      ],
    },
  ],
};

export default topic;
