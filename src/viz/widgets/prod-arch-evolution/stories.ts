// Architecture eras for prod-evolution (Airbnb, Netflix, Shopify). Every fact, date and number is
// taken from the topic's own text (src/content/topics/prod-evolution.ts).

export type BoxKind = 'client' | 'edge' | 'app' | 'service' | 'data' | 'tool';

export interface Box {
  id: string;
  label: string;
  sub?: string;
  kind: BoxKind;
}

export interface Era {
  id: string;
  years: string;
  title: string;
  /** rows top → bottom; calls flow downward between adjacent rows */
  rows: Box[][];
  /** what the change was */
  change: string;
  /** numbers / results reported for this era */
  facts: string[];
  /** the pressure that eventually forced the NEXT change (absent on the last era) */
  pressure?: { text: string; hot: string[] };
  /** a sidecar box drawn to the right (e.g. schema registry) */
  side?: Box;
}

export interface Story {
  id: string;
  label: string;
  sections: string;
  eras: Era[];
  lesson: string;
}

export const STORIES: Story[] = [
  {
    id: 'airbnb',
    label: 'Airbnb',
    sections: '§2–4',
    eras: [
      {
        id: 'monorail',
        years: '2008 – ~2016',
        title: 'The Monorail',
        rows: [
          [{ id: 'client', label: 'client', kind: 'client' }],
          [{ id: 'monorail', label: 'Monorail', sub: 'one Ruby on Rails MVC app', kind: 'app' }],
          [{ id: 'mysql', label: 'MySQL', kind: 'data' }],
        ],
        change: 'A single Rails app. A 2014 new-hire task touched the model, the view and the controller in one place, which was easy.',
        facts: ['one codebase, one deploy'],
        pressure: {
          text: 'By 2018: 200 commits deployed to the Monorail per day, with its deploy blocked about 15 hours per week; one model with thousands of lines and hundreds of contributors; more incidents and slower deploy trains as headcount grew (800+ engineers in 2017, 1,000+ in 2018).',
          hot: ['monorail'],
        },
      },
      {
        id: 'soa',
        years: '~2016 – 2018',
        title: 'Four-tier SOA',
        rows: [
          [{ id: 'client', label: 'client', kind: 'client' }],
          [{ id: 'gw', label: 'API gateway', kind: 'edge' }],
          [{ id: 'pres', label: 'presentation', sub: 'checkout pres.', kind: 'service' }],
          [{ id: 'mid', label: 'middle tier', sub: 'reservation validation', kind: 'service' }],
          [{ id: 'derived', label: 'derived data', sub: 'home demand', kind: 'service' }],
          [
            { id: 'home', label: 'Home data', kind: 'data' },
            { id: 'resv', label: 'Reservation data', kind: 'data' },
          ],
        ],
        change: 'Services own the reads and writes to their data; each addresses one concern; mutations propagate via standard events (SpinalTap CDC). Dependencies flow strictly downward through four tiers. Traffic moved with dual reads ramped 1% → 5% → 10% → 25% → 50% → 100% and shadow-database writes.',
        facts: ['250+ services on the IDL framework, 1,000+ endpoints (2018)', 'build + deploy: hours → minutes', 'search page 3× faster, home description page 10× faster'],
        pressure: {
          text: 'By 2023: 400+ services and 1,000+ deploys a day, but a change could span several services deployed in order; business logic was fragmented; unconstrained calls built a tangled graph with circular dependencies; one reservation presentation service had to call a very large number of services to hydrate one host page.',
          hot: ['pres', 'mid', 'derived'],
        },
      },
      {
        id: 'blocks',
        years: 'by 2023',
        title: 'Service blocks + a data graph',
        rows: [
          [{ id: 'client', label: 'client', kind: 'client' }],
          [{ id: 'viaduct', label: 'Viaduct', sub: 'GraphQL data graph', kind: 'edge' }],
          [
            { id: 'listing', label: 'LISTING block', sub: 'facade', kind: 'service' },
            { id: 'pricing', label: 'PRICING block', sub: 'facade', kind: 'service' },
          ],
          [{ id: 'internal', label: 'internal services', sub: 'not callable from outside', kind: 'service' }],
        ],
        change: 'Related services are grouped behind a facade; clients may call only the facade, and blocks may not have circular dependencies. Viaduct, a data-oriented GraphQL engine, maps fields to the services that own them, and the client-facing API is unified.',
        facts: ['listing details page: calls to the listing block 11 → 1', 'the Monorail still serves a "very long tail" of old mobile clients'],
      },
    ],
    lesson: 'The tiers controlled the direction of calls but not fan-out. A service architecture needs a second round of boundaries: blocks, layers and a data graph.',
  },
  {
    id: 'netflix',
    label: 'Netflix',
    sections: '§5–7',
    eras: [
      {
        id: 'dc',
        years: '2008',
        title: 'Own data centres',
        rows: [
          [{ id: 'client', label: 'members', kind: 'client' }],
          [{ id: 'mono', label: 'monolithic app', kind: 'app' }],
          [{ id: 'rdbms', label: 'big RDBMS', sub: 'vertically scaled', kind: 'data' }],
        ],
        change: 'A monolithic app on a vertically scaled relational database in Netflix\'s own data centres.',
        facts: ['DVD shipping depends on one database'],
        pressure: { text: 'August 2008: a major database corruption meant Netflix could not ship DVDs to members for three days. One vertically scaled single point of failure could stop the business.', hot: ['rdbms'] },
      },
      {
        id: 'cloud',
        years: '2009 – Jan 2016',
        title: 'Cloud-native rebuild on AWS',
        rows: [
          [{ id: 'client', label: 'client', kind: 'client' }],
          [{ id: 'lb', label: 'hardware LB', sub: 'terminates TLS', kind: 'edge' }],
          [{ id: 'nccp', label: 'NCCP / API', sub: 'orchestrates all features', kind: 'app' }],
          [
            { id: 'svcA', label: 'svc A', kind: 'service' },
            { id: 'svcB', label: 'svc B', kind: 'service' },
            { id: 'svcC', label: 'svc C', kind: 'service' },
          ],
          [{ id: 'nosql', label: 'NoSQL + relational', kind: 'data' }],
        ],
        change: 'Rebuild, not lift-and-shift: hundreds of microservices, NoSQL alongside relational stores, continuous delivery. Chaos Monkey (Dec 2010) kills instances on purpose; the Simian Army followed in July 2011. The last streaming data-centre resources were shut down in early January 2016, after seven years.',
        facts: ['8× the streaming members of 2008', 'viewing up three orders of magnitude in eight years', 'availability approaching four nines'],
        pressure: { text: 'Features moved into microservices but the orchestration stayed in the API app (NCCP), so every new feature still meant changing it: "the return of the monolith". Clients also coupled to backend topology.', hot: ['nccp'] },
      },
      {
        id: 'zuul',
        years: 'stages 3–4, to 2018',
        title: 'Zuul gateway + split APIs',
        rows: [
          [{ id: 'client', label: 'all devices', kind: 'client' }],
          [{ id: 'zuul', label: 'Zuul gateway', sub: 'auth, routing, sticky canaries', kind: 'edge' }],
          [{ id: 'bff', label: 'Node.js BFFs', sub: 'owned by UI teams', kind: 'service' }],
          [
            { id: 'play', label: 'playback API', kind: 'service' },
            { id: 'disc', label: 'discovery API', kind: 'service' },
          ],
          [{ id: 'micro', label: 'microservices (100s)', kind: 'service' }],
        ],
        change: 'NCCP split by experience into playback and discovery; Zuul centralises authentication and self-service routing (one path at a time, canaries, sticky canaries); active-active multi-region from 2013–2014. Zuul 2 was rebuilt on Netty in 2016.',
        facts: ['Zuul 2: ~25% more throughput with 25% less CPU on the light logging cluster; no significant gain on the CPU-heavy API cluster', '2018: 80+ Zuul 2 clusters, ~100 backend clusters, > 1M requests/s'],
        pressure: { text: 'Studio Engineering (~2018): data in many services led to single-use aggregation layers and lagging materialised views; inconsistent data across Studio apps was the top support issue in 2018. A single curated "Studio API" graph then made one small team the bottleneck.', hot: ['bff'] },
      },
      {
        id: 'federation',
        years: '2019 – 2022',
        title: 'GraphQL federation',
        rows: [
          [{ id: 'client', label: 'client', kind: 'client' }],
          [{ id: 'gql', label: 'GraphQL gateway', sub: 'query plan, ~10 ms', kind: 'edge' }],
          [
            { id: 'movie', label: 'Movie DGS', kind: 'service' },
            { id: 'prod', label: 'Production DGS', kind: 'service' },
            { id: 'talent', label: 'Talent DGS', kind: 'service' },
          ],
        ],
        side: { id: 'registry', label: 'schema registry', sub: 'checks every push', kind: 'tool' },
        change: 'Keep one unified schema, decentralise resolvers to domain teams (Domain Graph Services). The registry checks every push is valid, composes and is backward compatible. In 2022 mobile apps moved off the Falcor monolith via a GraphQL shim, then field by field with @override, replay testing and sticky canaries.',
        facts: ['70 DGSes by late 2020', 'A/B test on 1M users; 100% of the mobile homepage moved in 6 months'],
      },
    ],
    lesson: 'The aggregation layer is where microservices quietly become a monolith again. Federation fixes ownership but adds a registry, composition rules and gateway latency.',
  },
  {
    id: 'shopify',
    label: 'Shopify',
    sections: '§8–9',
    eras: [
      {
        id: 'rails',
        years: 'to 2016',
        title: 'One Rails app, by Rails concept',
        rows: [
          [{ id: 'client', label: 'merchants + buyers', kind: 'client' }],
          [{ id: 'app', label: 'Rails monolith', sub: 'models / views / controllers', kind: 'app' }],
          [{ id: 'db', label: 'MySQL', sub: 'sharded in 2015', kind: 'data' }],
        ],
        change: 'One of the largest Rails codebases, worked on for over a decade by more than a thousand developers.',
        facts: ['2015: could no longer scale by buying bigger database servers, so it sharded'],
        pressure: { text: 'Sharding improved performance but hurt resilience: shared code iterated over all shards, so one failed shard could make an action unavailable platform-wide.', hot: ['db'] },
      },
      {
        id: 'pods',
        years: '2016',
        title: 'Pods: isolate the data, not the code',
        rows: [
          [{ id: 'client', label: 'shop-123.myshopify.com', kind: 'client' }],
          [{ id: 'hat', label: 'OpenResty + Sorting Hat', sub: 'host → pod header', kind: 'edge' }],
          [{ id: 'app', label: 'shared Rails app + jobs', sub: 'stateless, same monolith', kind: 'app' }],
          [
            { id: 'pod1', label: 'Pod 1', sub: 'MySQL · Redis · memcached', kind: 'data' },
            { id: 'pod7', label: 'Pod 7', sub: 'MySQL · Redis · memcached', kind: 'data' },
            { id: 'pod42', label: 'Pod 42', sub: 'dedicated: big brand', kind: 'data' },
          ],
        ],
        change: 'A pod is a set of shops on a fully isolated set of datastores. Each web request or job touches exactly one pod; nothing reads across pods. Pod Mover fails a pod over in about a minute; the shop mover rebalances shops with under 10 s of downtime for many stores (under 20 s for larger ones).',
        facts: ['runtime isolation without a network hop between domains'],
        pressure: { text: 'Pods isolate tenants, not code. By 2016 the code was fragile (a change to tax calculation could break shipping rates), tests were slow, and onboarding meant understanding orders, payments and more first.', hot: ['app'] },
      },
      {
        id: 'components',
        years: '2017 – 2020',
        title: 'Modular monolith + Packwerk',
        rows: [
          [{ id: 'client', label: 'requests (via pods)', kind: 'client' }],
          [
            { id: 'orders', label: 'orders', sub: 'public API', kind: 'service' },
            { id: 'shipping', label: 'shipping', kind: 'service' },
            { id: 'billing', label: 'billing', kind: 'service' },
            { id: 'inventory', label: 'inventory', kind: 'service' },
          ],
          [{ id: 'platform', label: 'platform', sub: 'base layer', kind: 'app' }],
          [{ id: 'pods', label: 'pods', sub: 'isolated datastores', kind: 'data' }],
        ],
        side: { id: 'packwerk', label: 'Packwerk in CI', sub: 'new violation → PR fails', kind: 'tool' },
        change: 'About 6,000 classes relabelled by business domain and moved in one scripted PR; each component exposes a public API and owns its data. Wedge (a call graph built in CI) took over an hour; Packwerk statically checks constant references in minutes, with old debt recorded in todo files.',
        facts: ['Sept 2020: 2.8M lines of Ruby, 500,000 commits, 37 components', 'one app, ~40 deploys a day'],
        pressure: { text: '2024 retrospective: domains and the boundaries between them do not reflect how Shopify\'s code actually functions; static analysis is blind to require, autoload, routes and initializers; privacy checks were removed in v3.0.', hot: ['platform'] },
      },
      {
        id: 'today',
        years: '2022 – 2024',
        title: 'Boot in isolation; extract only different risk profiles',
        rows: [
          [{ id: 'client', label: 'edge', sub: 'BFCM 2024 peak: 284M req/min', kind: 'client' }],
          [
            { id: 'mono', label: 'monolith', sub: 'checkout stays here', kind: 'app' },
            { id: 'sfr', label: 'storefront renderer', sub: 'read-heavy rewrite', kind: 'service' },
            { id: 'card', label: 'CardSink / CardServer', sub: 'PCI scope', kind: 'service' },
          ],
          [{ id: 'pods', label: 'pods', kind: 'data' }],
        ],
        change: 'Progress is measured by code that boots in isolation rather than a violation count. What left the monolith did so for a different risk or runtime profile (card data, the storefront renderer, shipping labels, Go and Lua hot paths), not domains in general.',
        facts: ['80M+ requests/min on app servers at the BFCM 2024 peak', '10.5 trillion database queries over the weekend'],
      },
    ],
    lesson: 'Separate code boundaries (components, Packwerk) from runtime boundaries (pods): strong runtime isolation is possible without a single network hop between domains.',
  },
];
