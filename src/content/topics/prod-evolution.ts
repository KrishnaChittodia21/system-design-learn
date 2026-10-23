import type { Topic } from '../../types';

const topic: Topic = {
  id: 'prod-evolution',
  phase: 'production',
  order: 6,
  title: 'Architecture Evolution Stories: Airbnb, Netflix & Shopify',
  subtitle:
    'Three companies hit the same growth wall and gave three different answers: layered SOA, cloud microservices behind a gateway, and a deliberately modular monolith split into pods. Each story is told stage by stage (trigger, constraint, decision, cost, lesson) from primary sources, then turned into a staged plan for a NestJS monolith',
  estimatedMinutes: 130,
  sources: [
    'Jessica Tai — Airbnb\'s Great Migration: From Monolith to Service-Oriented (QCon SF 2018 slides)',
    'Selina Liu — Airbnb at Scale: From Monolith to Microservices (QCon Plus, InfoQ, April 2023)',
    'Netflix — Completing the Netflix Cloud Migration (about.netflix.com, Feb 2016, Yury Izrailevsky)',
    'Netflix TechBlog — 5 Lessons We\'ve Learned Using AWS (Dec 2010) and The Netflix Simian Army (July 2011)',
    'Vasily Vlasov — Evolution of Edge @Netflix (QCon SF 2019, InfoQ)',
    'Netflix TechBlog — Zuul 2: The Netflix Journey to Asynchronous, Non-Blocking Systems (2016) and Open Sourcing Zuul 2 (2018)',
    'Suudhan Rangarajan — Netflix Play API: Why we built an Evolutionary Architecture (QCon SF 2018 slides)',
    'Netflix TechBlog — How Netflix Scales its API with GraphQL Federation, Part 1 (Nov 2020)',
    'Netflix TechBlog — Migrating Netflix to GraphQL Safely (2023)',
    'Shopify Engineering — Deconstructing the Monolith (Kirsten Westeinde, Feb 2019)',
    'Shopify Engineering — Under Deconstruction: The State of Shopify\'s Monolith (Philip Müller, Sep 2020)',
    'Shopify Engineering — A Packwerk Retrospective (Feb 2024)',
    'Shopify Engineering — A Pods Architecture to Allow Shopify to Scale (Xavier Denis, March 2018)',
    'Bart de Water — Shopify\'s Architecture to Handle the World\'s Biggest Flash Sales (QCon Plus, InfoQ, Oct 2022)',
    'Shopify — Black Friday Cyber Monday 2024 press release (SEC exhibit 99.1, Dec 2024)',
  ],
  tags: [
    'case-study',
    'architecture-evolution',
    'soa',
    'microservices',
    'modular-monolith',
    'strangler-fig',
    'api-gateway',
    'graphql-federation',
    'packwerk',
    'pods',
    'multi-tenancy',
    'fitness-functions',
    'nestjs',
  ],
  cheatSheet: [
    'Tell any evolution story in five beats: trigger (a measured pain) → constraint (what you could not change) → decision (and the options you rejected) → cost (what got worse) → lesson (what you would repeat or avoid).',
    'Airbnb: Rails "Monorail" (2008) → by the 2018 QCon talk, 200 commits/day and deploys blocked ~15 h/week → SOA with four tiers (presentation → middle tier → derived data → data), with calls flowing down only. Services own their data, and mutations go out as events (SpinalTap).',
    'Airbnb\'s migration mechanics: route ORM calls to services, then dual-read and compare, ramping 1% → 5 → 10 → 25 → 50 → 100%. Writes go to a shadow DB for comparison; migrate per endpoint and even per attribute; replay traffic with Diffy. Results: deploys went from hours to minutes, search page 3× faster, home page 10× faster.',
    'Airbnb\'s aftermath (2023 talk): 400+ services, 1,000+ deploys/day, but a tangled graph, circular dependencies, and features that need ordered deploys of many services. The fix was service blocks (a facade plus no cycles) and a GraphQL data layer (Viaduct): one listing-page path went from 11 calls to 1.',
    'Netflix: in Aug 2008 a DB corruption stopped DVD shipping for 3 days. Netflix rebuilt cloud-native on AWS rather than lift-and-shift, finishing in Jan 2016 after 7 years. Chaos Monkey was one of the first things built in AWS ("the best way to avoid failure is to fail constantly").',
    'Netflix edge: the NCCP monolith was the only client-facing app → microservices, but the API orchestrator grew back into a monolith → NCCP was split into playback and discovery → Zuul gateway (auth, self-service routing, sticky canaries) → Zuul 2 on Netty (80+ clusters, >1M RPS in 2018). The gain was connection scaling, not CPU efficiency.',
    'Netflix GraphQL: one team\'s Studio API graph became the bottleneck → federation (Domain Graph Services, schema registry checks, gateway query plans, ~10 ms planning overhead, 70 DGSes in 2020). In 2022 mobile moved Falcor → GraphQL via a shim, an A/B test on 1M users, replay tests and sticky canaries.',
    'Shopify: kept one Rails monolith on purpose (2.8M lines, 37 components in 2020) and enforced boundaries with Packwerk (static constant-reference checks plus todo files). Retrospective: "a sharp knife". Privacy checks were dropped in v3.0, and domain boundaries did not match runtime behaviour.',
    'Shopify pods: after sharding in 2015, one bad shard could break an action for everyone. Since 2016 each pod is a set of shops on fully isolated datastores, with shared stateless app servers and workers. Sorting Hat (OpenResty Lua) routes each request to its pod, and Pod Mover fails a pod over in about a minute. BFCM 2024 edge peak: 284M requests/min.',
    'Anti-patterns to name: distributed monolith (shared fat client libraries, lockstep deploys), premature extraction before the domain is understood, shared database, an aggregation layer owned by one team, and a migration whose last 10% never ends. The counter for each is a fitness function in CI, not a wiki page.',
  ],
  sections: [
    {
      heading: '1. Why evolution stories win interviews, and the five-beat way to tell one',
      body: `**Intuition:** an architecture is a photo, but interviewers want the film. A senior engineer is judged less on knowing what Netflix runs today and more on explaining *why it changed, what it cost, and what you would do at the same stage*.

**Why these three companies.** They faced the same pressure: more engineers, more traffic and more product surface all colliding in one codebase. They chose three different answers:

| | Airbnb | Netflix | Shopify |
|---|---|---|---|
| Starting point | Rails monolith "Monorail" (2008) | Data-centre monolith on a big relational DB; NCCP as the one client-facing app | Rails monolith, one of the largest in existence |
| Main trigger | Deploy contention, incidents, slow trains | 3-day outage from DB corruption (2008), then growth | Fragile code, slow CI, onboarding needing the whole codebase in your head |
| Answer | Layered **SOA** with strict tiers | Cloud-native **microservices** behind a **gateway**, later **federated GraphQL** | **Modular monolith** + **pods** for runtime isolation |
| What it cost | Multi-year migration, tangled service graph | A 7-year migration, async complexity, many teams on call | Boundary tooling that was hard to use; still one deploy unit |

**The five beats.** Use them for these case studies *and* for your own projects in behavioural rounds:

1. **Trigger:** a measured pain, not a fashion. "Deploys were blocked 15 hours a week", not "the code was messy".
2. **Constraint:** what you could not change, e.g. no downtime, no feature freeze, mobile clients you cannot force-upgrade, a team of 12.
3. **Decision:** the option chosen *and the options rejected, with reasons*. This is the beat that shows judgement.
4. **Cost:** what got worse. Every evolution moves complexity around; strong candidates say where it went.
5. **Lesson:** what you would repeat, and what you would do earlier.

**In interviews say this:** "Airbnb, Netflix and Shopify hit the same wall and chose SOA, microservices and a modular monolith. The common thread is that each moved only when a metric forced it, migrated incrementally behind a seam, and later had to fight the coupling the new architecture created. I'd pick between them based on team count, deploy contention and isolation needs, not on company size."`,
      diagram: `  TRIGGER        CONSTRAINT       DECISION         COST          LESSON
 (a metric)    (can't change)   (+ rejected)    (what got      (repeat /
                                                  worse)        avoid)
 +---------+   +-----------+   +-----------+   +---------+   +---------+
 | deploys |-->| no freeze |-->| SOA tiers |-->| 400 svc |-->| invest  |
 | blocked |   | no down-  |   | not:      |   | tangled |   | in infra|
 | 15h/wk  |   | time      |   | rewrite   |   | graph   |   | early   |
 +---------+   +-----------+   +-----------+   +---------+   +---------+
      ^                                                           |
      +------------- the lesson becomes the next trigger ---------+`,
      keyPoints: [
        'Every story has a measured trigger; "the code is messy" is not a trigger.',
        'Naming the rejected options is the beat that signals seniority.',
        'Say where the complexity went: every evolution moves it, none removes it.',
        'The same five beats work for behavioural "tell me about a migration" questions.',
      ],
      source: 'Synthesis of the primary sources listed for this topic',
    },
    {
      heading: '2. Airbnb, stage 1–2: from the Monorail to a four-tier SOA',
      body: `**Intuition:** a single kitchen works until 200 cooks share one stove. Airbnb did not buy a bigger stove. It built separate stations, each owning its ingredients, with strict rules about who may ask whom for what.

**Stage 1: the Monorail.** Airbnb started in 2008 as a single Ruby on Rails MVC app, later nicknamed the *Monorail*. A 2014 new-hire task ("add a required message to the host") touched the model, the view template and the controller in one place, which was easy. By Jessica Tai's 2018 QCon talk the growing pains were concrete:

- **200 commits deployed to the Monorail per day**, with the Monorail deploy **blocked about 15 hours per week**;
- one model (the host-message model) with *thousands of lines and hundreds of contributors*;
- more incidents and slower deploy trains as headcount grew (800+ engineers in 2017, 1,000+ in 2018).

**Stage 2: the decision, an SOA with tenets.** The tenets on Airbnb's slides are worth quoting in an interview because they are design rules, not slogans:

1. **Services own the reads and writes to their data.** No other service touches their tables.
2. **Each service addresses a specific concern.**
3. **Avoid duplicate functionality.**
4. **Mutations propagate via standard events.** Airbnb open-sourced *SpinalTap* for change-data capture.

**The four tiers, with a strict downward flow of dependencies:**

| Tier | Job | Example on the checkout page |
|---|---|---|
| Presentation | Synthesise data from services for end users | Checkout presentation service |
| Middle tier | Shared business logic across disparate data sources | Reservation validation |
| Derived data | Read data services + apply logic; own a derived store | Home demand (offline booking-trend stats) |
| Data | Own reads and writes to one entity | Home data, Reservation data |

Clients talk to an **API gateway**. During the migration, the Monorail itself called services (the "interim" shape) until the gateway could route straight to presentation services.

**Why the tiers matter:** they turn "who may call whom" into a rule you can check. A data service never calls a presentation service, so cycles can only appear *within* a tier. In section 4 you will see that this was not enough on its own.`,
      diagram: `   Stage 1 (2008-~2016)              Stage 2 (SOA, from ~2016-18)

   client                             client
     |                                  |
 +-----------+                    [ API gateway ]
 | MONORAIL  |                          |
 | Rails MVC |                  +-------v--------+  presentation
 | models    |                  | checkout pres. |  (aggregate)
 | views     |                  +---+--------+---+
 | ctrls     |                      |        |
 +-----+-----+                +-----v----+   |     middle tier
       |                      | resv.    |   |     (shared logic)
   [ MySQL ]                  | validate |   |
                              +--+-----+-+   |
                                 |     |  +--v---------+ derived data
                                 |     |  | home demand|
                                 |     |  +--+---------+
                              +--v-+ +-v---v+          data tier
                              |resv| | home |  (own reads+writes)
                              +--+-+ +--+---+
                                [DB]   [DB]   calls flow DOWN only`,
      code: [
        {
          language: 'typescript',
          title: 'The tier rule as a CI check: a lower tier may never call a higher one',
          code: `// tiers.ts: each service declares its tier; CI fails on an upward or same-tier call
type Tier = 'presentation' | 'middle' | 'derived' | 'data';
const RANK: Record<Tier, number> = { presentation: 3, middle: 2, derived: 1, data: 0 };

interface ServiceDecl {
  name: string;
  tier: Tier;
  calls: string[]; // read from each service's generated client manifest
}

export function tierViolations(services: ServiceDecl[]): string[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const out: string[] = [];
  for (const s of services) {
    for (const target of s.calls) {
      const t = byName.get(target);
      if (!t) {
        out.push(s.name + ' calls unknown service ' + target);
        continue;
      }
      // data -> data is allowed only via events, never sync; everything else must go strictly down
      if (RANK[t.tier] >= RANK[s.tier]) {
        out.push(s.name + ' (' + s.tier + ') -> ' + t.name + ' (' + t.tier + ') is not a downward call');
      }
    }
  }
  return out;
}

// example: the checkout page from Airbnb's slides
const violations = tierViolations([
  { name: 'checkout-presentation', tier: 'presentation', calls: ['reservation-validation', 'home-demand'] },
  { name: 'reservation-validation', tier: 'middle', calls: ['reservation-data', 'home-data'] },
  { name: 'home-demand', tier: 'derived', calls: ['home-data'] },
  { name: 'home-data', tier: 'data', calls: [] },
  { name: 'reservation-data', tier: 'data', calls: [] },
]);
if (violations.length) {
  console.error(violations.join('\\n'));
  process.exit(1);
}`,
        },
      ],
      keyPoints: [
        'The trigger was deploy contention (200 commits/day, ~15 h/week blocked), not request throughput.',
        'Tenet #1, that services own their reads and writes, is what rules out the shared database.',
        'The four tiers make the dependency direction checkable.',
        'Events (CDC via SpinalTap) carry mutations across services instead of cross-service writes.',
      ],
      source: 'Jessica Tai — Airbnb\'s Great Migration (QCon SF 2018); Selina Liu — Airbnb at Scale (InfoQ 2023)',
    },
    {
      heading: '3. Airbnb, stage 3: how they actually moved traffic (dual reads, shadow writes, ramps)',
      body: `**Intuition:** you do not move house by carrying everything at once. You move one room, live in both houses for a while, and check that nothing went missing before you hand back the keys.

**Step 1: intercept at the ORM, not the controller.** Airbnb's first cut was a **custom ActiveRecord adapter**. Code still called \`Home.find_by_host_id(4)\`, but instead of emitting SQL, the adapter parsed the query into a request object (\`type: select, table: homes, filters: host_id = 4, select: [id, host_id, title]\`) and sent it to the Home service. Hundreds of call sites moved without being edited. In NestJS the equivalent seam is the **repository**: swap the TypeORM/Prisma implementation behind the same interface.

**Step 2: dual-read comparison for reads.** Both read paths run: the monolith's DB read (path A) and the service (path B). A gate decides who answers, a comparator logs differences, and an admin UI controls the ramp: **1% → 5% → 10% → 25% → 50% → 100%**, waiting at each step to gather traffic patterns. Only when differences are explained does "switch" send all traffic through the service.

**Step 3: write comparison with a shadow database.** Writes are riskier, because you cannot "compare and throw away" a side effect. Airbnb dual-wrote to **separate databases**: the real one, plus a shadow one owned by the service path, then compared them.

**Step 4: migrate in small units.** Migrate **by endpoint**: compare one endpoint at a time, and unblock clients even if the service is incomplete. Migrate **by attribute**: read migrated attributes from the service and not-yet-migrated ones from the old path.

**Step 5: standardise service building.** A Thrift IDL generated endpoints, Java and Ruby clients, metrics and alerts. Twitter's **Diffy** replayed production traffic against old and new builds and filtered out non-deterministic noise.

**Results reported in 2018:** 250+ services on the IDL framework, 1,000+ endpoints; build and deploy went from **hours (Monorail) to minutes (service)**; the **search results page was 3× faster and the home description page 10× faster**, because multi-threaded Java services could parallelise calls that single-threaded Ruby made in sequence.

**The caution slide** is the part most retellings drop: *"SOA is not for everyone"*: distributed services, complex orchestration, high investment cost, and you must "be ready for a long commitment".`,
      diagram: `            production traffic
                    |
              [ gate / ramp ]  <-- admin UI: 1% 5% 10% 25% 50% 100%
               /          \\
     read path A          read path B
     (monolith ORM)       (Home data service)
          |                    |
       [ MySQL ]          [ service DB ]
          \\                    /
           +---> [ compare ] <-+
                    |
            diff log + metrics  --> explain every diff --> ramp up
                                                     \\--> or roll back

   writes: primary path -> real DB ; service path -> SHADOW DB ; diff offline`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS seam: the repository decides between DB and service, per call site, by flag',
          code: `// homes.repository.ts: callers keep calling findByHostId(); the seam picks the path
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HomeServiceClient } from './home-service.client';
import { Flags } from '../flags/flags.service';

export interface HomeRow { id: number; hostId: number; title: string }

@Injectable()
export class HomesRepository {
  private readonly log = new Logger(HomesRepository.name);
  constructor(
    private readonly db: DataSource,
    private readonly homes: HomeServiceClient,
    private readonly flags: Flags,
  ) {}

  async findByHostId(hostId: number): Promise<HomeRow[]> {
    // the flag names the endpoint, so each read path ramps on its own
    const mode = this.flags.mode('homes.findByHostId'); // 'db' | 'shadow' | 'service'
    if (mode === 'service') return this.homes.loadHomes({ hostId, fields: ['id', 'hostId', 'title'] });

    const rows: HomeRow[] = await this.db.query(
      'SELECT id, host_id AS "hostId", title FROM homes WHERE host_id = $1 ORDER BY id', [hostId]);

    if (mode === 'shadow') {
      // fire-and-forget: never let the new path add latency or errors to the old one
      void this.homes.loadHomes({ hostId, fields: ['id', 'hostId', 'title'] })
        .then((svc) => {
          if (JSON.stringify(svc) !== JSON.stringify(rows)) this.log.warn({ msg: 'homes.diff', hostId });
        })
        .catch((e: Error) => this.log.warn({ msg: 'homes.shadow_error', err: e.message }));
    }
    return rows;
  }
}`,
        },
      ],
      keyPoints: [
        'Intercept at the data-access seam so hundreds of call sites move without edits.',
        'Reads: dual-read and compare, ramped 1% → 100% with a wait at each step.',
        'Writes: a shadow database, because side effects cannot be compared and discarded.',
        'Migrate by endpoint and by attribute, so you are never blocked on a complete service.',
      ],
      source: 'Jessica Tai — Airbnb\'s Great Migration (QCon SF 2018)',
    },
    {
      heading: '4. Airbnb, stage 4: what broke after SOA, and what they say about it now',
      body: `**Intuition:** you replaced one tangled ball of wool with 400 balls connected by strings, and now the strings are tangled.

**Where Airbnb was by 2023 (Selina Liu, QCon Plus):** the company-wide SOA initiative launched in 2018, and migrating core product functionality took **two to three years**. Airbnb now runs **400+ services** and **1,000+ deploys a day**. The Monorail is still not fully decommissioned: older iOS and Android clients and some legacy traffic still hit it, with a "very long tail" expected.

**What went wrong (their words, paraphrased):**
- **Shipping features got slower.** A change could span several services that had to be deployed *in order*.
- **Business logic was repeated and fragmented** across services.
- **Unconstrained calls built a tangled dependency graph with circular dependencies.** That made onboarding harder and outages harder to debug.
- A reservation presentation service ("Ramen") had to call a very large number of services just to *hydrate* the data for one host page.

**What they did:**
1. **Service blocks.** Related services are grouped behind a **facade**. Clients may call only the facade, never a block's internal services, and **blocks may not have circular dependencies**. This brings back the module boundary, one level up.
2. **Platformise data hydration with GraphQL (Viaduct).** Viaduct is a Kotlin GraphQL engine that is data-oriented rather than service-oriented: you ask for fields, and directives map types to the services that own them. On the listing details page, calls to the listing block went **from 11 to 1**.
3. **Unify the client-facing API** and lean on server-driven UI. They later moved partway back from fully server-driven UI, because it blocked native platform features.

**Their four lessons:** invest in common infrastructure *early*; simplify dependencies with layers and blocks; platformise common patterns such as hydration; unify the client-facing API.

**The interview takeaway:** Airbnb's SOA was not a failure. Deploys, latency and ownership all improved. But a service architecture needs its own *second* round of boundaries (blocks, layers, a data graph). The tiers controlled direction but not fan-out, and fan-out became the new pain.`,
      diagram: `   Before service blocks                  After service blocks

   pres --> a --> b --+                    pres
     \\      ^     |   |                     |
      +---> c <---+   |                [ LISTING block facade ]
            |         v                  /     |      \\   (internal:
            +-------> d <---+          svc1   svc2   svc3  not callable)
                      |     |
                      e ----+  (cycle)   [ PRICING block facade ]
                                            |
   11 calls to hydrate one page        listing page: 11 calls -> 1
                                       rule: no cycles between blocks`,
      keyPoints: [
        '400+ services and 1,000+ deploys/day came with ordered multi-service deploys and cycles.',
        'Service blocks = facade + no internal calls from outside + no cycles: modularity one level up.',
        'A GraphQL data layer (Viaduct) cut one page\'s calls from 11 to 1.',
        'Even after years, the monolith\'s long tail (old mobile clients) kept it alive.',
      ],
      source: 'Selina Liu — Airbnb at Scale: From Monolith to Microservices (QCon Plus 2023, InfoQ)',
    },
    {
      heading: '5. Netflix, stage 0–1: a 3-day outage, a 7-year cloud rebuild, and why chaos engineering was born there',
      body: `**Intuition:** Netflix did not move to the cloud to save money. It moved because one database could stop the business, and in the new world every server would be disposable. So it built a tool that throws servers away on purpose.

**Trigger (August 2008):** a major database corruption meant Netflix **could not ship DVDs to members for three days**. The lesson Netflix drew was to stop depending on vertically scaled single points of failure in its own data centres and to move to horizontally scalable, distributed systems in the cloud.

**Decision: rebuild, don't lift-and-shift.** Netflix chose AWS for scale and breadth of services and **rebuilt virtually all of its technology** as cloud-native: from a monolithic app to **hundreds of microservices**, with NoSQL alongside relational stores, and from centralised release coordination to continuous delivery by DevOps-style teams. All customer-facing services were in the cloud before 2015. The last streaming data-centre resources were shut down in **early January 2016, after seven years**. Billing and employee/customer data were among the last pieces, because they needed a secure path to the cloud.

**Numbers from the 2016 post:** 8× as many streaming members as in 2008; overall viewing up by **three orders of magnitude in eight years**; cloud cost per streaming start was "a fraction" of the data-centre cost, thanks to elasticity rather than spare buffers; and availability was approaching the goal of **four nines**.

**Chaos engineering origin (Dec 2010, about a year into the move):** in "5 Lessons We've Learned Using AWS", Netflix said:
- in its own data centres, session state in memory and *chatty APIs* had been fine; in AWS, instance failure and network latency variance were normal, so both had to go;
- "**the best way to avoid failure is to fail constantly**". **Chaos Monkey**, which randomly kills instances and services, was "one of the first systems our engineers built in AWS";
- it copied *full customer request traffic* to the new AWS systems with a simple repeater, because toy load tests had not revealed the real bottlenecks.

In July 2011 the **Simian Army** followed: Latency Monkey (injected delays), Conformity Monkey (instances that break best practice, e.g. outside an auto-scaling group), Doctor, Janitor and Security Monkeys, and **Chaos Gorilla** (simulate the loss of a whole availability zone).

**The lesson:** the migration was an *architecture* change that used the infrastructure change as its forcing function. Chaos Monkey existed because the new architecture assumed failure, and that assumption had to be tested continuously or it would rot.`,
      diagram: `  2008                 2009-2015                    Jan 2016
 +--------------+     +-------------------------+     +------------------+
 | own DCs      |     | AWS, rebuilt cloud-     |     | last streaming   |
 | monolith app | --> | native: 100s of micro-  | --> | DC resources off |
 | big RDBMS    |     | services, NoSQL, CD     |     | (billing last)   |
 +--------------+     +-------------------------+     +------------------+
   Aug 2008:            Dec 2010: Chaos Monkey,
   DB corruption ->     "fail constantly"; traffic
   3 days no DVDs       repeater to AWS
                        Jul 2011: Simian Army
                        (Latency, Conformity, Chaos Gorilla = lose an AZ)`,
      keyPoints: [
        'Trigger: a single DB corruption = 3 days without shipping (Aug 2008).',
        'Decision: cloud-native rebuild, not lift-and-shift; it took 7 years (done Jan 2016).',
        'Chaos Monkey was built early because the new architecture assumed instance failure.',
        'Replay real traffic to the new system: toy load models hide the real bottlenecks.',
      ],
      source: 'Netflix — Completing the Netflix Cloud Migration (2016); Netflix TechBlog — 5 Lessons We\'ve Learned Using AWS (2010), The Netflix Simian Army (2011)',
    },
    {
      heading: '6. Netflix, stage 2–4: NCCP, the orchestrator that became a monolith again, and the Zuul gateway',
      body: `**Intuition:** splitting the kitchen into stations does not help if one head waiter still has to shout every order to every station. The waiter becomes the new bottleneck.

**Stage 2a: the three-tier start.** Per Vasily Vlasov (Netflix Cloud Gateway lead, QCon SF 2019), the original streaming architecture was a client, a single API application and a database. That app was **NCCP (Netflix Content Control Protocol)**, the *only* client-facing application, behind a hardware load balancer that terminated TLS. At that stage the optimisation target was time to market, and that was the right call.

**Stage 2b: microservices, but the orchestrator grows back.** Features were extracted into microservices, but the **orchestration logic stayed in the API app**, so every new feature still meant changing it. Vlasov quotes Josh Evans calling this "the return of the monolith".

**Stage 3: split by experience, then add a gateway.** NCCP was split into one app for **playback** and one for **discovery**. Clients orchestrated across multiple domains and load balancers, which coupled every device to the backend topology. **Zuul** was introduced as the API gateway to remove that coupling:
- **centralised authentication** with an end-to-end identity token, and **routing rules** (including per-user overrides for testing);
- **self-service routing**: teams publish rules to shard traffic, onboard a new origin, migrate "one path at a time", run canaries, and run **sticky canaries** that keep a user on the new build;
- **Node.js backends-for-frontends** so UI engineers could own their device-specific edge logic;
- resiliency: "random choice of two" load balancing and retries on behalf of clients, plus cross-region proxying during region evacuation (**active-active multi-region from 2013–2014**; a 60 s DNS TTL is not honoured by every resolver).

**Stage 4: Zuul 2 on Netty (2016).** Netflix rebuilt Zuul as async and non-blocking. The honest result: **no significant efficiency gain** on the CPU-heavy API cluster, about **25% more throughput with 25% less CPU** on the light logging cluster, and the real win was **connection scaling** (cheap connections that enable push). The cost was code that is harder to debug, plus thread-local assumptions in shared libraries that had to be removed. By 2018 Netflix ran **80+ Zuul 2 clusters** in front of about **100 backend clusters at more than 1M requests per second**.

**The Play API coda (QCon SF 2018):** Netflix found it hit architectural limits roughly every three years. The previous Play API suffered from **binary coupling** (thick shared libraries with hundreds of dependencies, effectively a distributed monolith), **operational coupling** (client libraries with heavy fallbacks that could take down the API) and a **data monolith** (several data sources loaded in memory, of which a small fraction was used). The fix was thin, auto-generated clients (gRPC), data behind an abstraction layer, and **fitness functions** to guide change, prioritising simplicity, then reliability, observability and latency.`,
      diagram: ` Stage 2a            Stage 2b                 Stage 3-4
 client              client                   client (all devices)
   |                   |                          |
 [HW LB]             [ NCCP / API ]           [ Zuul gateway ]  auth, routing,
   |                 orchestrates ALL             |             sticky canary,
 [ NCCP ]            /    |     \\               /   |   \\        retries
   |              svcA  svcB  svcC          [BFFs, Node.js]
 [ DB ]           ("return of the            /     |     \\
                   monolith")           playback  discovery  signup
                                         API       API       API
                                          |  \\      |        |
                                        microservices (100s), NoSQL`,
      code: [
        {
          language: 'typescript',
          title: 'Zuul-style self-service routing in a NestJS gateway: rules, sticky canaries, path-by-path migration',
          code: `// route-rules.ts: rules are data (published by teams), not code deployed with the gateway
import { createHash } from 'node:crypto';

export interface RouteRule {
  id: string;
  pathPrefix: string;      // e.g. '/api/playback/'
  origin: string;          // e.g. 'playback-v2'
  percent: number;         // 0-100 share of users sent to origin
  sticky: boolean;         // same user always gets the same answer
  header?: { name: string; value: string }; // e.g. route QA users explicitly
}

// a stable bucket 0-99 per (user, rule): changing one rule never reshuffles another
function bucket(userId: string, ruleId: string): number {
  const h = createHash('sha1').update(ruleId + ':' + userId).digest();
  return h.readUInt16BE(0) % 100;
}

export function pickOrigin(
  rules: RouteRule[],
  req: { path: string; userId?: string; headers: Record<string, string | undefined> },
  fallback: string,
): string {
  // longest prefix wins, so a team can carve one path out of a broader rule
  const candidates = rules
    .filter((r) => req.path.startsWith(r.pathPrefix))
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
  for (const r of candidates) {
    if (r.header && req.headers[r.header.name.toLowerCase()] === r.header.value) return r.origin;
    if (r.percent >= 100) return r.origin;
    if (r.percent <= 0) continue;
    // anonymous traffic cannot be sticky: send it to the old origin rather than flapping
    if (r.sticky && !req.userId) continue;
    const b = r.sticky ? bucket(req.userId!, r.id) : Math.floor(Math.random() * 100);
    if (b < r.percent) return r.origin;
  }
  return fallback;
}`,
        },
      ],
      keyPoints: [
        'Extracting services while orchestration stays central recreates the monolith in the API layer.',
        'Split by experience (playback vs discovery), then put a gateway between devices and topology.',
        'Self-service routing rules turn migrations and canaries into data changes.',
        'Zuul 2\'s win was connection scaling, not CPU; async cost debuggability.',
        'Shared fat client libraries are binary coupling, the hidden distributed monolith.',
      ],
      source: 'Vasily Vlasov — Evolution of Edge @Netflix (QCon SF 2019); Netflix TechBlog — Zuul 2 (2016), Open Sourcing Zuul 2 (2018); Suudhan Rangarajan — Netflix Play API (QCon SF 2018)',
    },
    {
      heading: '7. Netflix, stage 5–6: from one team\'s graph to GraphQL federation, and the safe mobile migration',
      body: `**Intuition:** a single shared library catalogue is great until one librarian has to shelve every book for 70 departments. Federation lets each department shelve its own books into one shared catalogue.

**Trigger (Studio Engineering, ~2018):** studio workflow data (titles, productions, talent) lived in many microservices. Teams coped by (1) building **single-use aggregation layers**, i.e. duplicated BFF or mid-tier fetch code, and (2) **materialised views** of other teams' data that lagged. *Inconsistent data across Studio apps was the top support issue in 2018.*

**Decision 1: one curated graph ("Studio API").** It was a runaway success with consumers, but it created new bottlenecks: the one Studio API team was far from the domain knowledge, so schema health suffered; wiring each new backend into the graph was manual; and one small team carried the whole operational load.

**Decision 2: federation ("Studio Edge").** Keep the *unified schema*, but **decentralise resolver implementation** to domain teams. Apollo published the Federation spec in early 2019, and Netflix built on it:
- **Domain Graph Service (DGS):** a GraphQL service owned and run by a domain team (a new service or a converted microservice).
- **Schema registry:** stores every DGS schema and checks that each push (a) is valid GraphQL, (b) **composes** with all other DGS schemas, and (c) is **backward compatible**.
- **Gateway:** builds a **query plan**, then fans sub-queries out to DGSs, in parallel where it can, joining entities by \`@key\`. Planning and execution add **~10 ms** of overhead.
- By late 2020: **70 DGSes** and hundreds of developers.

**Stage 6: moving consumer mobile apps off Falcor (2022).** The legacy API was a monolithic Falcor server owned by one API team, with "over a decade of tech debt". Netflix migrated iOS and Android to federated GraphQL **with zero downtime** in phases:
1. **GraphQL shim over the existing Falcor monolith** (from summer 2020), so clients could move first. An **A/B test on 1M users** compared error rates, latency and time-to-render, and found correctness problems (cache TTLs, flawed client assumptions) that took months to fix. **100% of the mobile homepage moved in 6 months.**
2. **Domain-owned DGSs replace the shim**, field by field. Federation's \`@override\` directive lets the gateway route one field to the new service. **Replay testing** sampled live traffic and diffed shim vs new service responses (noise included localisation, date precision and float accuracy). **Sticky canaries** covered non-idempotent and performance behaviour that replay could not test.

**The lesson:** the aggregation layer is where "microservices" quietly become a monolith again. Federation fixes *ownership*, but it adds a registry, composition rules and gateway latency, and it only pays off when many teams contribute to one graph.`,
      diagram: `  Studio API (one team)              Studio Edge (federated)

  client                             client
    |                                  |
 [ Studio API graph ]            [ GraphQL gateway ] <-- composed schema
   all resolvers here                 | query plan        ^
   (bottleneck team)            /     |      \\            |
    /     |      \\          Movie   Production  Talent  [ schema registry ]
  svcA  svcB   svcC          DGS      DGS        DGS     valid? composes?
                             (team)   (team)    (team)   backward compatible?
                           join by @key; parallel where possible; ~10 ms`,
      code: [
        {
          language: 'graphql',
          title: 'Federation: an entity owned by one DGS, extended by another, and @override to move one field',
          code: `# --- movie-dgs schema (owns Movie) ---
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@override"])

type Query {
  movies(first: Int = 10): [Movie!]!
}

type Movie @key(fields: "movieId") {
  movieId: ID!
  title: String!
}

# --- production-dgs schema (contributes fields to Movie) ---
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

type Movie @key(fields: "movieId") {
  movieId: ID!              # the join key the gateway sends in _entities representations
  production: Production
}

type Production {
  shootingLocation: String
  vendors: [String!]!
}

# --- video-dgs schema (migration: take over one field from the legacy shim) ---
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@override"])

type Video @key(fields: "videoId") {
  videoId: ID!
  # the gateway now resolves maturityRating here instead of in the 'shim' subgraph;
  # removing the directive (or the field) rolls the move back
  maturityRating: String @override(from: "shim")
}`,
        },
      ],
      keyPoints: [
        'Duplicated aggregation layers and lagging materialised views were the trigger.',
        'A single curated graph solves consistency but recreates a team bottleneck.',
        'Federation = domain-owned DGSs + a registry that checks composition and compatibility + a planning gateway.',
        'Safe migrations combine A/B tests, replay diffs and sticky canaries, each covering what the others cannot.',
      ],
      source: 'Netflix TechBlog — How Netflix Scales its API with GraphQL Federation, Part 1 (2020); Migrating Netflix to GraphQL Safely (2023)',
    },
    {
      heading: '8. Shopify, stage 1–2: the deliberately modular monolith and Packwerk',
      body: `**Intuition:** instead of moving every department into its own building, Shopify kept one building and put locked doors between the departments, with a list of who holds which key.

**Trigger (2016):** Shopify's core is one of the largest Ruby on Rails codebases in existence, worked on for over a decade by more than a thousand developers. By 2016 the pains were concrete. Code was **fragile**: a change to tax calculation could break shipping rates. Tests were slow and hard to write. Onboarding required understanding orders, payments and more before shipping anything. A developer survey confirmed this.

**Why not microservices (their reasoning):** each service needs its own test and deploy pipeline plus infrastructure; teams would not always have the data they need when they need it; every cross-service call adds network latency and reduces reliability; and large refactors across services need coordinated deploys. Their definition of the answer is a **modular monolith**: *all code powers a single application, with strictly enforced boundaries between domains*.

**Stage 1: componentization (from early 2017).**
1. **Reorganise by business domain**, not by Rails concept: orders, shipping, inventory, billing instead of models/views/controllers. They listed **about 6,000 Ruby classes in a spreadsheet**, labelled each with a component, and moved them all in **one scripted PR**. The cost was that GitHub history showed deletions and creations.
2. **Isolate dependencies:** each component exposes a public API and exclusively owns its data.
3. **Enforce boundaries**, and untangle the dependency graph.

The first measurement tool, **Wedge**, built a call graph with Ruby tracepoints during CI. It was accurate but took **over an hour**, which is too slow for feedback.

**Stage 2: Packwerk (2020).** By September 2020 the monolith had **2.8M lines of Ruby, 500,000 commits and 37 components**. Early analysis showed every component depended on more than half of the others. Packwerk *statically* checks **constant references** in minutes, runs on pull requests, and rejects changes that break the declared dependency graph. Existing violations are recorded in **todo files**, so legacy debt does not block CI but *new* debt does. At the time it covered about a third of the components. Progress was measured by **change locality** (how many components a PR touches, which should fall over time) and by removing edges from the graph.

**The 2024 retrospective is the senior-level part:** Packwerk is "a sharp knife, and it must be wielded with care".
- **Privacy checks** (public API folders) bent Rails conventions and turned the tool into an API design tool. They were **removed in v3.0**.
- Static analysis is **blind** to \`require\`, autoload, routes, fixtures and initializers.
- Most importantly, "**domains and the boundaries between them do not reflect the way Shopify's code actually functions**". A fraud model ended up in the base layer because every shop request needs it. Isolating one clean base package took many months, and tests still failed until initializers moved into engines.
- The conclusion: **running code that boots in isolation is a better measure of progress than a violation count**.`,
      diagram: ` 2016: one app, by Rails concept   2017+: same app, by business domain

 app/models/      (~6,000 classes,  components/
 app/views/        any class can      orders/     <- public API
 app/controllers/  call any other)    shipping/   package.yml deps:
        |                             billing/      [orders, platform]
    [ MySQL ]                         inventory/
 tax change breaks shipping           platform/   <- base layer

 CI: Wedge call graph (> 1 h)       CI: Packwerk constant refs (minutes)
                                      new violation -> PR fails
                                      old violation -> package_todo.yml`,
      code: [
        {
          language: 'yaml',
          title: 'Packwerk-style package declaration and todo file (the shape of the idea)',
          code: `# components/shipping/package.yml
enforce_dependencies: true      # references to undeclared packages fail CI
dependencies:
  - components/orders           # shipping may use orders' constants
  - components/platform         # the shared base layer
# no dependency on billing: a tax/billing change can no longer break shipping silently

---
# components/shipping/package_todo.yml  (generated, checked in, should only shrink)
# Existing debt is recorded so CI is green today; adding a new entry needs a reviewer.
components/billing:
  "::Billing::TaxRate":
    violations:
      - dependency
    files:
      - components/shipping/app/models/shipping/rate_calculator.rb

---
# components/platform/package.yml
enforce_dependencies: true
dependencies: []                # the base layer depends on nothing: the hardest one to make true`,
        },
      ],
      keyPoints: [
        'Shopify rejected microservices for pipeline overhead, data access, latency and cross-service refactors.',
        'Componentize by business domain; move code first (one scripted PR), isolate dependencies second.',
        'Fast static checks with a todo baseline beat slow, accurate call graphs for feedback.',
        'The retrospective: static boundaries can mislead; code that boots in isolation is the real milestone.',
      ],
      source: 'Shopify Engineering — Deconstructing the Monolith (2019); Under Deconstruction (2020); A Packwerk Retrospective (2024)',
    },
    {
      heading: '9. Shopify, stage 3: pods for tenant isolation, and the few things that left the monolith',
      body: `**Intuition:** code modularity stops one team breaking another team's *code*. It does not stop one tenant's flash sale from melting another tenant's *database*. That needs isolation at runtime, so Shopify split the *data*, not the code.

**Trigger (2015–2016):** Shopify could no longer scale by buying bigger database servers, so in **2015 it sharded**. Sharding improved performance but **hurt resilience**: shared code iterated over all shards, so **one failed shard could make an action unavailable platform-wide**.

**Decision (2016): pods.** A **pod** is a set of shops living on a **fully isolated set of datastores** (MySQL, Redis, memcached). This is not a Kubernetes pod.
- **Isolated per pod:** stateful datastores. **Shared:** stateless app servers, job workers and load balancers, so capacity can be balanced across pods in a region.
- **Rule:** each unit of work (a web request or a background job) touches **exactly one pod**, and **no action may reach across pods**. Cross-shop features live in separate apps or the data warehouse.
- **Routing:** **Sorting Hat**, a Lua module in OpenResty (NGINX + Lua) at the edge, looks up the request's host in a routing table, finds the pod, adds a header, and forwards. App servers use the header to connect to the right datastores.
- **Disaster recovery:** each pod has an active data centre and a recovery one. **Pod Mover** fails a pod over in about **a minute** without dropping requests or jobs. Evacuating a data centre means moving its pods one at a time.
- **Rebalancing:** new shops are assigned to pods in turn. The **shop mover** copies a shop's data and tails the binlog (Ghostferry) to move it to another pod. Shopify reported under 10 s of downtime for many stores and under 20 s for larger ones. The largest merchants may get a dedicated pod.

**What did leave the monolith (QCon 2022):** pieces with a *different risk or runtime profile*, not domains in general. **CardSink/CardServer** isolate card data (PCI scope), the **storefront renderer** is a separate rewrite because read traffic dwarfs writes, shipping labels run as a service, and Go and Lua handle performance-critical paths. **Checkout stays in the monolith.** The monolith deploys about **40 times a day**.

**Scale it serves:** Shopify's BFCM 2024 release reported an edge peak of **284M requests per minute**, more than **80M/min on app servers**, 1.19 trillion edge requests and 10.5 trillion database queries over the weekend.

**The lesson:** separate *code* boundaries (components, Packwerk) from *runtime* boundaries (pods). You can have strong runtime isolation without a single network hop between domains.`,
      diagram: `                    request: shop-123.myshopify.com
                                  |
                   +--------------v---------------+
                   |  OpenResty edge + Sorting Hat |  host -> pod lookup
                   |  (Lua): add header pod=7      |
                   +--------------+---------------+
                                  |
          shared, stateless: Rails app servers + job workers (same monolith)
               |                  |                    |
        +------v------+    +------v------+      +------v------+
        |   POD 1     |    |   POD 7     |      | POD 42      |
        | MySQL Redis |    | MySQL Redis |      | (dedicated: |
        | memcached   |    | memcached   |      |  big brand) |
        +------+------+    +-------------+      +-------------+
               |  active DC <-> recovery DC  (Pod Mover ~1 min)
     rule: one unit of work = one pod; nothing reads across pods`,
      code: [
        {
          language: 'typescript',
          title: 'Sorting-Hat-style tenant routing for a NestJS app: resolve pod once, bind the data source per request',
          code: `// pod-routing.middleware.ts: one request touches exactly one pod's datastores
import { Injectable, NestMiddleware, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool } from 'pg';

export const podContext = new AsyncLocalStorage<{ podId: number; db: Pool }>();

@Injectable()
export class PodRoutingMiddleware implements NestMiddleware {
  constructor(
    private readonly routes: Map<string, number>, // host -> podId, refreshed from the routing table
    private readonly pools: Map<number, Pool>,    // one pg pool per pod, created at boot
    private readonly locked: Set<string>,         // shops mid-move: brief write lock
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const host = (req.headers['x-shop-host'] as string | undefined) ?? req.hostname;
    const podId = this.routes.get(host);
    const db = podId === undefined ? undefined : this.pools.get(podId);
    if (podId === undefined || !db) return next(new ServiceUnavailableException('unknown shop'));
    // during a shop move, fail writes fast with a retryable status instead of writing to the old pod
    if (this.locked.has(host) && req.method !== 'GET') {
      res.setHeader('Retry-After', '5');
      return next(new ServiceUnavailableException('shop moving'));
    }
    res.setHeader('x-pod', String(podId));
    // everything downstream (repositories, jobs enqueued) reads the pod from context
    podContext.run({ podId, db }, () => next());
  }
}`,
        },
      ],
      keyPoints: [
        'Sharding alone hurt resilience: code that loops over all shards fails on any one of them.',
        'Pod = isolated datastores for a set of shops; app servers and workers stay shared and stateless.',
        'One unit of work = one pod; Sorting Hat at the edge picks it.',
        'Services were extracted only for a different risk or runtime profile (PCI, storefront reads).',
      ],
      source: 'Shopify Engineering — A Pods Architecture to Allow Shopify to Scale (2018); Bart de Water — QCon Plus 2022 (InfoQ); Shopify BFCM 2024 press release',
    },
    {
      heading: '10. Three answers to the same growth pressure: SOA vs microservices vs modular monolith',
      body: `**Intuition:** all three companies had the same disease, too many people changing one thing. Airbnb split the thing along *layers and data ownership*. Netflix split it along *teams and failure domains*, and pushed resilience into the platform. Shopify split the *code* logically and the *data* physically, and kept one deploy.

**What each optimised for:**
- **Airbnb:** independent deploys and clear data ownership, with tiers to keep the graph acyclic. It paid in migration years and a fan-out problem it later fixed with service blocks and GraphQL.
- **Netflix:** availability under constant failure, and team autonomy at very high scale. It paid with a platform investment (gateway, chaos tooling, federation) that most companies cannot afford.
- **Shopify:** developer productivity *without* network boundaries, plus tenant isolation for flash sales. It paid in boundary tooling that was hard to get right, and in one deploy pipeline everyone shares.

**Decision table:**

| Dimension | Layered SOA (Airbnb) | Microservices + gateway (Netflix) | Modular monolith + pods (Shopify) |
|---|---|---|---|
| Unit of deploy | Service | Service | One app (~40 deploys/day) |
| Boundary enforced by | Network + tier rules + IDL | Network + team ownership | Static checks (Packwerk) + code review |
| Data ownership | Each data service owns its entity | Each service owns its store | Each component *should* own its tables; same DB cluster per pod |
| Cross-domain call cost | Network hop (ms), partial failure | Network hop, retries, fallbacks | Method call (µs), atomic transactions possible |
| Isolation of failures | Per service | Per service + region evacuation + chaos | Per **pod** (tenant), not per domain |
| Main later pain | Tangled graph, ordered deploys | Orchestrator/aggregation re-monolith; async complexity | Boundaries that don't match runtime behaviour |
| Fits when | Many teams, clear entity ownership, can invest in a platform | Very many teams, extreme availability needs, mature platform org | Strong single-domain product, multi-tenant, team wants speed without distribution |

**How to choose in an interview (heuristics, not laws):**
1. **Count teams and measure deploy contention first.** If fewer than about 8 teams share the code and the deploy queue is not the bottleneck, a modular monolith almost always wins.
2. **Separate the three problems:** *code coupling* (fix with modules and boundary checks), *runtime blast radius* (fix with cells or pods, bulkheads, separate worker deployments), and *independent scaling* (often fixable by deploying the same code with different entrypoints).
3. **Extract a service for a different risk or runtime profile**: PCI scope, a GPU/ML workload, a read path 100× hotter than writes, or a different availability target.
4. **Expect a second round of boundaries** after any split: Airbnb's blocks, Netflix's federation, Shopify's base layer.`,
      diagram: `            same pressure: more engineers + more traffic + one codebase
                                   |
         +-------------------------+--------------------------+
         |                         |                          |
   AIRBNB: layers            NETFLIX: teams/failure     SHOPIFY: code modules
   pres > mid > derived      gateway -> BFF -> 100s     + data pods
   > data  (network)         of services (network)      (one deploy)
         |                         |                          |
   later: service blocks     later: GraphQL federation  later: base layer,
   + Viaduct GraphQL         + thin gRPC clients        "boots in isolation"
         \\                         |                          /
          +-------- everyone adds a SECOND boundary layer ----+`,
      keyPoints: [
        'Same disease (too many people changing one thing), three different cuts.',
        'Separate code coupling, runtime blast radius and independent scaling; each has a different fix.',
        'Extract services for different risk or runtime profiles, not by default.',
        'Every split needs a second round of boundaries later.',
      ],
    },
    {
      heading: '11. Anti-patterns seen in these migrations, and the fitness function that catches each',
      body: `**Intuition:** each company's "lesson" slide is really a list of the traps it fell into. Name the trap, the company that hit it, and the automated check that would have caught it early.

| Anti-pattern | Who hit a version of it | Symptom | Fitness function / counter |
|---|---|---|---|
| **Distributed monolith via shared libraries** | Netflix Play API (thick shared libs with hundreds of dependencies) | One library bump forces many coordinated releases | Count transitive shared-lib dependencies per service; allow only thin generated clients |
| **Operational coupling in clients** | Netflix Play API (client libs with heavy fallbacks could bring the API down) | A dependency's client code runs inside your process and exhausts it | Client libs must be generated, with timeouts/bulkheads owned by the caller |
| **Re-monolith in the orchestrator / aggregation layer** | Netflix NCCP/API; Netflix Studio API | Every feature PR touches the one orchestrator; one team is the queue | Track % of feature PRs touching the aggregation layer; federate when one team owns >N teams' resolvers |
| **Tangled graph / cycles** | Airbnb post-SOA; Shopify (every component depended on >half the others) | Ordered multi-service deploys; outages hard to trace | CI rejects new cycles; tier/block rules; graph edge count trends down |
| **Shared database** | Ruled out by Airbnb tenet #1 (services own reads & writes) | Schema change in A breaks B at runtime | Per-module DB roles/schemas; CI fails on SQL touching another module's schema |
| **Premature extraction** | Shopify's argument against microservices; Fowler's warning cited by Shopify | Services drawn before the domain is understood, then merged back | Extract only after the module has had a stable public API and low change-coupling for months |
| **Big-bang moves without comparison** | Avoided by Airbnb (dual reads, shadow writes) and Netflix (A/B, replay, sticky canary) | Silent data divergence found weeks later | Diff-rate SLO (e.g. < 0.1% unexplained) gates each ramp step |
| **The migration that never ends** | Airbnb Monorail long tail (old mobile clients); Shopify Packwerk todo files | Two systems run forever; ownership is unclear | Remaining-traffic dashboard per legacy endpoint; deletion dates; client version sunset policy |
| **Measuring the tool, not the outcome** | Shopify Packwerk retrospective | Violation count falls, but the code still cannot boot alone | Fitness function = "component boots and its tests pass in isolation" |

**In interviews say:** "Before I extract anything I want three fitness functions in CI: no new cross-module imports outside declared dependencies, no SQL across module schemas, and no new cycles. Each extraction then has a diff-rate gate and a deletion date for the old path. Airbnb and Netflix show that the comparison step is what makes these migrations safe, and Shopify's retrospective shows that the real milestone is code running in isolation, not a lint count."`,
      code: [
        {
          language: 'sql',
          title: 'Fitness function: each module gets its own schema and role, so a cross-module query fails',
          code: `-- One schema + one login role per module, inside the SAME Postgres (modular monolith)
CREATE SCHEMA orders;   CREATE ROLE orders_app LOGIN;
CREATE SCHEMA payments; CREATE ROLE payments_app LOGIN;

GRANT USAGE ON SCHEMA orders TO orders_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orders TO orders_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA orders
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orders_app;

GRANT USAGE ON SCHEMA payments TO payments_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payments TO payments_app;

-- payments may READ a narrow, versioned view of orders: the published contract
CREATE VIEW orders.v1_order_summary AS
  SELECT id, customer_id, total_paise, status, updated_at FROM orders.orders;
GRANT SELECT ON orders.v1_order_summary TO payments_app;

-- CI fitness check: list every grant that crosses module schemas except published views
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE '%\\_app' ESCAPE '\\'
  AND table_schema <> replace(grantee, '_app', '')
  AND table_name !~ '^v[0-9]+_';   -- published, versioned views (v1_..., v2_...) are allowed
-- expected: 0 rows. Any row = a module reaching into another module's tables.`,
        },
      ],
      keyPoints: [
        'Every anti-pattern here was hit by at least one of the three companies.',
        'Comparison (dual reads, replay, A/B) is what made their migrations safe.',
        'Per-module schemas and roles make "shared database" fail fast instead of fail late.',
        'Measure outcomes (boots in isolation, change locality), not tool scores.',
      ],
    },
    {
      heading: '12. Applying it: a staged plan for a NestJS monolith at an Indian startup',
      body: `**Intuition:** you are neither Netflix nor Shopify. You are 30 engineers with one NestJS app, one Postgres, a UPI/Razorpay checkout, and a sale day coming. Borrow the *sequence* from these stories, not their end state.

**Illustrative starting point** (example numbers, adjust to yours): about 30 engineers in 5 squads, one NestJS repo, one Postgres primary with a replica, BullMQ on Redis, and a merge-to-prod time of about 50 minutes. The CTO's question is: "Do we move to microservices?"

**Stage A: make the modules real (weeks 0–8).** This is Shopify's step 1.
- Reorganise \`src/\` by domain (\`orders\`, \`payments\`, \`catalog\`, \`notifications\`, \`platform\`), each a Nest module with one public \`index.ts\`.
- Declare allowed dependencies per module, and **record existing violations in a todo file** so CI is green today.
- *Fitness functions:* new cross-module imports outside declared dependencies = 0; new cycles = 0; todo entries only go down.

**Stage B: own the data (months 2–6).** This is Airbnb tenet #1 without the network.
- One Postgres **schema and role per module**. Cross-module reads go through a published view or the module's service API. Cross-module side effects go through **events** (an outbox table + BullMQ/Kafka), not direct writes.
- *Fitness functions:* cross-schema grants outside published views = 0; % of PRs touching more than 2 modules (change locality) trends down.

**Stage C: runtime isolation without services (months 4–9).** This is Shopify's pods idea, scaled down.
- Deploy the *same image* with different entrypoints: \`api\`, \`workers-critical\` (payments, OTP), \`workers-bulk\` (exports, emails). Each gets its own HPA and DB pool budget.
- If you are multi-tenant B2B, add a **tenant → cell** routing table early, even with one cell. It is cheap now and very expensive later.
- *Fitness functions:* a bulk-job flood cannot raise checkout p99 (load test in CI weekly); pool connections per deployment are within budget.

**Stage D: extract the first service only for a different profile (months 6–12).** This is Airbnb's comparison discipline.
- Good first candidates: anything PCI-scoped, a search/read path that is 50× hotter than writes, or a Python ML scorer. Bad candidates: orders or checkout, the transactional heart.
- Put a **facade** in front: shadow-read and compare, then ramp 1 → 5 → 25 → 100% with a sticky hash, a kill switch, and a **deletion date** for the old path.
- *Fitness functions:* unexplained diff rate < 0.1% before each ramp step; extracted service p99 within budget; old path traffic → 0 by the deletion date.

**Stage E: only if many teams need one API (12+ months).** This is Netflix's federation lesson.
- If 6+ teams queue on one BFF or GraphQL layer, consider **GraphQL federation** with schema checks in CI. Before that, a single NestJS GraphQL gateway with DataLoader is simpler.

**Answer to the CTO:** "Not microservices this year. Modular monolith with enforced boundaries and per-module schemas in Q1–Q2, separate worker deployments for isolation, and one extraction, payments tokenisation, behind a comparison facade. We re-evaluate when deploy contention or a team's autonomy, measured by DORA metrics, says otherwise."`,
      diagram: ` A: modules       B: own data       C: isolate runtime  D: extract one
+------------+   +-------------+   +---------------+   +-------------+
| NestJS     |   | schema +    |   | same image,   |   | facade +    |
| orders     |-->| role per    |-->| 3 deployments |-->| shadow +    |
| payments   |   | module +    |   | api / crit /  |   | sticky ramp |
| catalog    |   | outbox      |   | bulk workers  |   | + delete    |
+------------+   +-------------+   +---------------+   +-------------+
 CI: no new       CI: no cross-     CI: bulk flood      gate: diff
 imports/cycles   schema grants     can't move p99      < 0.1% / step

 E: federate the API layer -- only if 6+ teams queue on one BFF/graph`,
      code: [
        {
          language: 'typescript',
          title: 'Fitness function as a Jest test: change locality from git history (trend, not a hard gate)',
          code: `// test/architecture/change-locality.spec.ts: run nightly; alert when the trend reverses
import { execFileSync } from 'node:child_process';

const MODULES = ['orders', 'payments', 'catalog', 'notifications', 'platform'];

function modulesTouched(files: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const m = /^src\\/modules\\/([^/]+)\\//.exec(f);
    if (m && MODULES.includes(m[1])) out.add(m[1]);
  }
  return out;
}

function mergeCommits(since: string): string[] {
  return execFileSync('git', ['log', '--merges', '--since=' + since, '--format=%H'], { encoding: 'utf8' })
    .split('\\n').filter(Boolean);
}

function filesIn(sha: string): string[] {
  // diff of the merge against its first parent = everything the PR changed
  return execFileSync('git', ['diff', '--name-only', sha + '^1', sha], { encoding: 'utf8' })
    .split('\\n').filter(Boolean);
}

describe('change locality', () => {
  it('fewer than 20% of merged PRs in the last 30 days touch more than 2 modules', () => {
    const shas = mergeCommits('30 days ago');
    if (shas.length < 20) return; // too little data to judge
    const wide = shas.filter((s) => modulesTouched(filesIn(s)).size > 2).length;
    const ratio = wide / shas.length;
    console.log('change-locality wide-PR ratio', ratio.toFixed(3), 'of', shas.length);
    expect(ratio).toBeLessThan(0.2); // tighten the threshold as boundaries improve
  });
});`,
        },
      ],
      keyPoints: [
        'Borrow the sequence (modules → data ownership → runtime isolation → selective extraction), not the end state.',
        'Each stage ships with fitness functions in CI, so progress is measured, not asserted.',
        'Extract first what has a different risk/runtime profile; never the transactional heart first.',
        'Federation is a many-teams problem; one team with one GraphQL gateway does not need it.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'prod-evolution-cc-1',
      title: 'A Packwerk-style boundary checker for a NestJS modular monolith',
      context:
        'Your 30-engineer team reorganised a NestJS app into src/modules/<name>/ with a public index.ts per module, and declared allowed dependencies in boundaries.json. A teammate wrote the CI check below. In a month, payments code has imported orders internals through a path alias, someone added a dynamic import() of a catalog repository, and the "legacy budget" of 100 violations has been both gamed and blocking.',
      task:
        'Rewrite the checker so it (1) sees every kind of import (static, type-only, re-exports, dynamic import(), require, and the @modules/* alias), (2) enforces declared dependencies and public-entrypoint-only access, (3) rejects cycles in the declared graph, and (4) uses a per-violation todo baseline so existing debt passes, new debt fails, and fixed debt must be removed from the baseline.',
      starter: {
        language: 'typescript',
        title: 'scripts/check-boundaries.ts (starter)',
        code: `import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/modules';
// { "payments": ["orders"], "orders": ["catalog"], ... }
const allowed: Record<string, string[]> = JSON.parse(readFileSync('boundaries.json', 'utf8'));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

let violations = 0;
for (const mod of readdirSync(ROOT)) {
  for (const file of walk(join(ROOT, mod))) {
    const src = readFileSync(file, 'utf8');
    // only single-line, single-quoted, relative imports
    const re = /^import .* from '(\\.\\.\\/.*)';$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const target = m[1].split('/')[1]; // '../payments/x' -> 'payments'
      if (target !== mod && !allowed[mod].includes(target)) {
        console.log('violation', file, '->', target);
        violations++;
      }
    }
  }
}
// legacy code has violations; tolerate up to 100 so CI stays green
if (violations > 100) process.exit(1);`,
      },
      hints: [
        'Regexes over source text miss multi-line imports, double quotes, export-from, import() and require. The TypeScript compiler already has a function that lists every imported module specifier of a file.',
        'Resolve every specifier to an absolute path first, including the alias, then map the path to a module with a trailing-slash prefix match ("src/modules/order/" must not match "src/modules/orders-legacy/").',
        'A single global count lets new violations in whenever old ones are fixed. Key the baseline by (file, target module, kind), so each entry is either still present, fixed (and must be deleted), or new (and fails).',
      ],
      solution: {
        language: 'typescript',
        title: 'scripts/check-boundaries.ts (solution)',
        code: `import ts from 'typescript';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';

const ROOT = resolve('src/modules');
const ALIAS = '@modules/';                    // tsconfig paths: "@modules/*": ["src/modules/*"]
const TODO = 'boundaries.todo.json';
const deps: Record<string, string[]> = JSON.parse(readFileSync('boundaries.json', 'utf8'));
const modules = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory());

// 1) the declared graph must be complete and acyclic (cycles = future distributed monolith)
for (const m of modules) if (!deps[m]) throw new Error('module ' + m + ' missing from boundaries.json');
const state = new Map<string, 'visiting' | 'done'>();
function dfs(m: string, path: string[]): void {
  if (state.get(m) === 'done') return;
  if (state.get(m) === 'visiting') throw new Error('declared cycle: ' + [...path, m].join(' -> '));
  state.set(m, 'visiting');
  for (const d of deps[m] ?? []) dfs(d, [...path, m]);
  state.set(m, 'done');
}
modules.forEach((m) => dfs(m, []));

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\\.tsx?$/.test(p) && !p.endsWith('.d.ts') ? [p] : [];
});
const moduleOf = (abs: string) => modules.find((m) => abs.startsWith(join(ROOT, m) + sep));
// only the module root ('@modules/orders') or its index file is public
const isPublicEntry = (abs: string, m: string) => {
  const base = abs.replace(/\\.tsx?$/, '');
  return base === join(ROOT, m) || base === join(ROOT, m, 'index');
};

// 2) collect violations, keyed so each can be baselined individually
const found = new Set<string>();
for (const file of walk(ROOT)) {
  const from = moduleOf(file)!;
  // preProcessFile lists static, type-only, export-from, dynamic import() and require() specifiers
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  for (const { fileName: spec } of info.importedFiles) {
    let abs: string | undefined;
    if (spec.startsWith('.')) abs = resolve(dirname(file), spec);
    else if (spec.startsWith(ALIAS)) abs = join(ROOT, spec.slice(ALIAS.length));
    if (!abs) continue;                       // npm package: not our concern here
    const to = moduleOf(abs + sep);           // trailing sep: 'order/' never matches 'orders-legacy/'
    if (!to || to === from) continue;
    const rel = relative(process.cwd(), file);
    if (!deps[from].includes(to)) found.add(rel + ' -> ' + to + ' [dependency]');
    else if (!isPublicEntry(abs, to)) found.add(rel + ' -> ' + to + ' [privacy: ' + spec + ']');
  }
}

// 3) compare with the baseline: new = fail, fixed-but-still-listed = fail (keeps the todo honest)
const todo = new Set<string>(existsSync(TODO) ? JSON.parse(readFileSync(TODO, 'utf8')) : []);
if (process.argv.includes('--update-todo')) {
  writeFileSync(TODO, JSON.stringify([...found].sort(), null, 2) + '\\n');
  console.log('baseline written:', found.size, 'entries');
  process.exit(0);
}
const fresh = [...found].filter((v) => !todo.has(v));
const stale = [...todo].filter((v) => !found.has(v));
fresh.forEach((v) => console.error('NEW  ', v));
stale.forEach((v) => console.error('FIXED (remove from ' + TODO + ')', v));
console.log('violations:', found.size, 'baselined:', todo.size, 'new:', fresh.length, 'stale:', stale.length);
process.exit(fresh.length || stale.length ? 1 : 0);`,
      },
      explanation: `**What was wrong and what changed:**

- **Blind spots:** the regex only saw single-line, single-quoted, relative \`import ... from\`. It missed multi-line imports, double quotes, \`export * from\`, \`import()\`, \`require()\` and the \`@modules/*\` alias, which is exactly how the payments → orders leak got in. \`ts.preProcessFile(src, true, true)\` returns every specifier, including dynamic imports.
- **Wrong module resolution:** \`m[1].split('/')[1]\` breaks for \`../../orders/x\` and for any depth other than one. The fix resolves to an absolute path and maps it with a trailing-separator prefix, so \`order/\` never matches \`orders-legacy/\`.
- **No privacy rule:** an allowed dependency could still deep-import \`orders/internal/order.repository\`. Now only the module root or \`index.ts\` is allowed (Packwerk later dropped its own privacy checks because of folder-layout friction; with one \`index.ts\` per Nest module, the rule is cheap here).
- **Crash on new modules:** \`allowed[mod].includes\` threw for undeclared modules. Now every module must be declared.
- **Cycles:** the declared graph is checked with a DFS. A cycle there legitimises a future distributed monolith.
- **Gameable budget:** "≤ 100 violations" let new debt in whenever someone fixed old debt, and blocked everyone once it hit 101. A per-violation baseline fails on *new* entries and on *stale* entries (fixed but still listed), which is the todo-file hygiene Shopify's retrospective says it got wrong.`,
      followUps: [
        {
          q: 'Static imports are now clean, but Nest DI still lets PaymentsService inject OrdersRepository because OrdersModule exports it. How do you catch that?',
          a: 'Import checks only see the type reference. The real boundary in Nest is a module\'s `exports` array. Add two checks: (1) a lint rule or script that each module\'s `exports` lists only its facade services, never repositories or entities; (2) an **isolation boot test** per module: `Test.createTestingModule({ imports: [PaymentsModule] })` with only its declared dependency modules, which fails if it silently needs something undeclared. That second check is the "boots in isolation" milestone Shopify\'s retrospective calls the real measure.',
        },
        {
          q: 'The check takes 90 s on 4,000 files and engineers want it in a pre-commit hook. What do you change?',
          a: 'Run it incrementally: in pre-commit, analyse only staged files (`git diff --cached --name-only`). The violation key is per file, so you can compare just those files\' entries against the baseline. `preProcessFile` is a parser, not a type-checker, so per-file cost is small; most of the 90 s is usually full `ts` program creation or `statSync` walks. Keep the full run in CI on every PR so baseline staleness is still caught, and cache results keyed by file content hash in CI.',
        },
      ],
    },
    {
      id: 'prod-evolution-cc-2',
      title: 'Extract pricing behind a strangler facade without users seeing prices flip',
      context:
        'You are extracting pricing from a NestJS monolith into a new pricing service. The first attempt (below) went live at 10%. Support tickets say the price on a product "changes every refresh", p99 of the product page doubled, and manual price overrides now sometimes exist in only one of the two systems.',
      task:
        'Redesign the facade so the migration is safe and reversible: a sticky per-user ramp, a shadow mode that cannot hurt latency or availability, a comparison that reports meaningful diffs only, a hard timeout with a clean fallback, a kill switch, and one write owner at a time.',
      starter: {
        language: 'typescript',
        title: 'pricing.controller.ts (starter)',
        code: `import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LegacyPricingService } from './legacy-pricing.service';

@Controller('api/pricing')
export class PricingController {
  constructor(private legacy: LegacyPricingService, private http: HttpService) {}

  @Get(':sku')
  async quote(@Param('sku') sku: string) {
    const pct = Number(process.env.PRICING_NEW_PCT ?? 0);
    if (Math.random() * 100 < pct) {
      try {
        const r = await firstValueFrom(this.http.get('http://pricing-svc/quote/' + sku));
        return r.data;
      } catch {
        return this.legacy.quote(sku);
      }
    }
    const old = await this.legacy.quote(sku);
    // shadow compare
    const fresh = await firstValueFrom(this.http.get('http://pricing-svc/quote/' + sku));
    if (old.price !== fresh.data.price) console.log('diff', sku);
    return old;
  }

  @Post(':sku/override')
  async override(@Param('sku') sku: string, @Body() body: { price: number }) {
    await this.legacy.setOverride(sku, body.price);
    await firstValueFrom(this.http.post('http://pricing-svc/override/' + sku, body));
    return { ok: true };
  }
}`,
      },
      hints: [
        'Math.random() decides per request, not per user. What would make the same user land on the same side for the whole ramp step?',
        'A shadow call that is awaited inline is not a shadow: it adds latency and its errors fail the request. Also give the new path a deadline and a fast fallback.',
        'Two sequential writes to two systems with no transaction will diverge. Who owns writes during the migration, and how does the other side learn about them?',
      ],
      solution: {
        language: 'typescript',
        title: 'pricing.facade.ts (solution)',
        code: `import { Controller, Get, Param, Post, Body, Req, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { LegacyPricingService } from './legacy-pricing.service';
import { Flags } from '../flags/flags.service';
import { Metrics } from '../metrics/metrics.service';

type Quote = { sku: string; pricePaise: number; currency: 'INR'; computedAt?: string };
const NEW_URL = process.env.PRICING_SVC_URL ?? 'http://pricing-svc';

@Controller('api/pricing')
export class PricingFacade {
  private readonly log = new Logger(PricingFacade.name);
  private shadowInFlight = 0;
  constructor(private legacy: LegacyPricingService, private flags: Flags, private m: Metrics) {}

  private bucket(userId: string): number {               // sticky 0..99 per user for this migration
    return createHash('sha1').update('pricing-v2:' + userId).digest().readUInt16BE(0) % 100;
  }

  private async fromNew(sku: string, timeoutMs: number): Promise<Quote> {
    const res = await fetch(NEW_URL + '/quote/' + encodeURIComponent(sku), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error('pricing-svc ' + res.status);
    return (await res.json()) as Quote;
  }

  private same(a: Quote, b: Quote): boolean {             // compare business meaning, ignore noise fields
    return a.sku === b.sku && a.currency === b.currency && a.pricePaise === b.pricePaise;
  }

  private shadow(sku: string, old: Quote): void {
    const cfg = this.flags.get('pricing.shadow');          // { sampleRate: 0.05, maxInFlight: 50 }
    if (Math.random() >= cfg.sampleRate || this.shadowInFlight >= cfg.maxInFlight) return;
    this.shadowInFlight++;
    this.fromNew(sku, 500)
      .then((q) => this.m.inc(this.same(old, q) ? 'pricing.shadow.match' : 'pricing.shadow.diff'))
      .catch(() => this.m.inc('pricing.shadow.error'))      // never surfaces to the user
      .finally(() => { this.shadowInFlight--; });
  }

  @Get(':sku')
  async quote(@Param('sku') sku: string, @Req() req: Request): Promise<Quote> {
    const f = this.flags.get('pricing.route');               // { mode, percent, killSwitch }
    const userId = (req.headers['x-user-id'] as string | undefined) ?? req.ip ?? 'anon';
    const useNew = !f.killSwitch && f.mode === 'canary' && this.bucket(userId) < f.percent;
    if (useNew) {
      try {
        const q = await this.fromNew(sku, 150);              // budget well under the page's p99
        this.m.inc('pricing.new.served');
        return q;
      } catch (e) {
        this.m.inc('pricing.new.fallback');                  // alert if this exceeds ~0.5%
        this.log.warn({ msg: 'pricing.fallback', sku, err: (e as Error).message });
      }
    }
    const old = await this.legacy.quote(sku);
    if (!f.killSwitch && f.mode !== 'legacy') this.shadow(sku, old);
    return old;
  }

  // ONE write owner at a time: the legacy side owns overrides until the cut-over.
  // The new service learns about them from the outbox/CDC stream, not from a second synchronous call.
  @Post(':sku/override')
  async override(@Param('sku') sku: string, @Body() body: { pricePaise: number }) {
    await this.legacy.setOverrideWithOutbox(sku, body.pricePaise); // same DB transaction writes the outbox row
    return { ok: true };
  }
}`,
      },
      explanation: `**Fixes, one by one:**

- **Prices flipping between refreshes:** \`Math.random()\` per request put the same user on different sides. A **sticky hash of userId + migration name** keeps each user on one side for a whole ramp step, which is the same idea as Netflix's sticky canaries.
- **Doubled p99:** the "shadow" call was awaited inline and its errors failed the request. Shadow is now **fire-and-forget, sampled, and capped by an in-flight limit**, so a slow new service cannot add latency or exhaust sockets.
- **No deadline:** the canary path could wait for the full socket timeout before falling back. \`AbortSignal.timeout(150)\` bounds it, and fallbacks are counted so a broken canary is visible.
- **Meaningless diffs:** comparing \`price\` (a float) ignored currency and flagged harmless noise. The comparator works in integer **paise**, checks currency, and ignores fields like \`computedAt\`, in the spirit of Diffy filtering non-deterministic noise for Airbnb.
- **Reversibility:** a **kill switch** and a mode flag (\`legacy | shadow | canary\`) make every step a config change.
- **Divergent overrides:** two sequential writes without a transaction diverge whenever the second fails. Now there is **one write owner** (legacy until cut-over), and the new service is fed through an **outbox/CDC stream**. Airbnb compared writes with a shadow DB rather than trusting dual writes.`,
      followUps: [
        {
          q: 'Shadow diff rate is 0.4% and every diff is on SKUs with an active coupon. What do you do before ramping further?',
          a: 'Freeze the ramp: 0.4% is above the < 0.1% unexplained-diff gate, and the cluster points at one rule rather than random noise. Pull 20–50 sampled diffs with the inputs (cart, user segment, coupon ID). Then decide whether the **new service is wrong** (coupon stacking or rounding order, for example rounding per line vs on the total in paise) or the **legacy is wrong** but users depend on it. Either fix the service, or document it as an accepted diff and add it to the comparator\'s known-differences list with an owner. Ramp only after the rate is below the gate for a full business cycle that includes a sale day.',
        },
        {
          q: 'How would you shadow-test the override endpoint, which is a write?',
          a: 'You cannot call a non-idempotent write twice on real state. Options: (1) **shadow database**: the new service applies the same command (from the outbox stream) to its own store, and a reconciler compares resulting state per SKU, which is Airbnb\'s write-comparison approach; (2) a **dry-run** flag on the new service that validates and computes the result without persisting it, then compare responses; (3) **sticky canary** for behaviour that cannot be compared, watching business metrics such as override errors and support tickets. Never mirror a write to both live systems synchronously.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'prod-evolution-iq-01',
      difficulty: 'medium',
      question:
        'Pick one of Airbnb, Netflix or Shopify and tell me its architecture evolution in three minutes. Then tell me one thing you think they got wrong or would do differently.',
      whatInterviewerLooksFor: [
        'A structured narrative (trigger → constraint → decision → cost → lesson), not a list of technologies',
        'Real, sourced facts and numbers rather than folklore',
        'Names the options that were rejected and why',
        'A critique grounded in the company\'s own retrospective, not hindsight snark',
      ],
      modelAnswer: `**Shopify, in five beats.**

**Trigger (2016):** one of the largest Rails monoliths, more than a thousand developers over a decade. Changes were fragile (a tax change could break shipping rates), CI was slow, and onboarding required knowing the whole system. A developer survey confirmed it.

**Constraint:** no feature freeze, a merchant platform that cannot go down, and a team that was very productive in Rails.

**Decision:** explicitly *not* microservices. They cited per-service pipelines and infra, data not being available where needed, network latency and reliability costs, and coordinated cross-service refactors. Instead they built a **modular monolith**: from 2017, about 6,000 classes reorganised into business-domain components in one scripted PR; then public APIs and data ownership per component; then **Packwerk** (2020) to statically reject undeclared dependencies on every PR, with todo files for legacy debt. For runtime isolation they used **pods**: shops on isolated datastores, shared stateless app servers, and Sorting Hat routing at the edge.

**Cost:** boundary tooling was hard. Wedge's call graph took over an hour. Packwerk's privacy checks bent Rails conventions and were removed in v3.0. In 2020 every component still depended on more than half the others.

**Lesson / what I'd do differently:** Shopify's own 2024 retrospective says domain boundaries did not match how the code actually runs, and that a static violation count can mislead. I would set the milestone as "this component **boots and passes its tests in isolation**" from day one, and measure change locality (components touched per PR) rather than violation counts. I would also start with the base/platform layer, because everything depends on it and its isolation took many months.

**Why this is a good story to tell:** it shows that the right answer to "the monolith hurts" can be *better boundaries in place*, plus runtime isolation where blast radius matters.`,
      followUps: [
        {
          q: 'Shopify still extracted some things. Which, and what is the rule?',
          a: 'Card handling (CardSink/CardServer) for PCI scope, a separately rewritten storefront renderer for the read-heavy path, and some shipping and performance-critical Go/Lua pieces. Checkout stayed in the monolith. The rule: extract when the piece has a **different risk or runtime profile** (compliance scope, a very different read/write ratio, a different language need), not just because it is a separate domain.',
        },
        {
          q: 'Tell the same story for Netflix in two sentences.',
          a: 'A 2008 database corruption stopped DVD shipping for three days, so Netflix spent seven years (done January 2016) rebuilding cloud-native on AWS as hundreds of microservices, with Chaos Monkey proving that instance failure was survivable. The cost was a heavy platform (the Zuul gateway, resilience tooling, and later GraphQL federation when a single API team became the bottleneck).',
        },
      ],
      pitfalls: [
        'Listing technologies ("they use Kafka, Cassandra, React") with no trigger or cost',
        'Inventing numbers ("Netflix has 10,000 microservices")',
        'Presenting the end state as if it were designed up front',
        'A critique that is pure hindsight with no reference to their constraints',
      ],
    },
    {
      id: 'prod-evolution-iq-02',
      difficulty: 'hard',
      question:
        'You are the architect at an Airbnb-2016-like moment: one Rails/NestJS monolith, about 200 commits a day, the deploy pipeline blocked around 15 hours a week, and headcount doubling every year. What do you do in the next 12 months?',
      context: 'Assume a single MySQL/Postgres primary, ~40 product teams by year end, and no appetite for a feature freeze.',
      whatInterviewerLooksFor: [
        'Diagnoses deploy contention as the primary problem, not traffic',
        'Proposes immediate relief (deploy pipeline, merge queue) before re-architecture',
        'Defines data ownership and a dependency direction before extracting services',
        'Plans an incremental, comparison-based migration with a platform investment',
        'States what will get worse',
      ],
      modelAnswer: `**1. Name the bottleneck.** 200 commits/day with ~15 h/week blocked is a **deploy-contention and ownership** problem. Per-request throughput is not the issue. More hardware won't help, and neither will a rewrite.

**2. Relief in weeks 0–6 (buys time):**
- A merge queue that batches commits and bisects automatically on failure; split slow test suites; deploy the monolith continuously in small batches.
- Ownership mapping: which team owns which controllers, models and tables, recorded as code owners.

**3. Set the rules before services (months 1–3):**
- Tenets: **a service owns the reads and writes of its data**; one concern per service; no duplicated functionality; **cross-service mutations go out as events (CDC)**.
- A dependency direction: presentation → middle tier → derived data → data. Only downward calls are allowed, and this is checked in CI.
- A service template: IDL (Thrift/gRPC/OpenAPI) with generated clients, standard metrics, alerts and dashboards. Airbnb listed early infrastructure investment as its first lesson.

**4. Migrate the data layer first (months 3–12):**
- Put a seam in the ORM/repository layer, so existing call sites start calling data services without being edited.
- **Reads:** dual-read and compare, ramping 1 → 5 → 10 → 25 → 50 → 100% with a wait at each step.
- **Writes:** compare against a shadow database. Never rely on fire-and-forget dual writes.
- Migrate per endpoint, and per attribute where needed, so teams are never blocked on a complete service.
- Replay production traffic (Diffy-style) against old and new paths before canaries.

**5. What will get worse (say it):** feature changes that span several services deployed in order; repeated business logic; more on-call surfaces; and fan-out on aggregation pages. Plan for service blocks/facades and a data-aggregation layer (GraphQL) in year two, and set a deletion date for monolith paths, because the long tail (old mobile clients) will otherwise live for years.

**Success metrics:** deploy wait time, deploys per team per day, change-failure rate, MTTR, and % of traffic served by services per endpoint.`,
      followUps: [
        {
          q: 'Why start with data services rather than presentation services?',
          a: 'Data ownership is the hardest coupling to undo and the one that blocks everything else. Once reads and writes for an entity go through one service, everything above can move independently and the shared-database coupling disappears. Starting at presentation produces services that still read the monolith\'s tables, which is a distributed monolith.',
        },
        {
          q: 'A VP asks for a date when the monolith is turned off. What do you say?',
          a: 'Give a date for **core functionality** (Airbnb took 2–3 years) and a separate, tracked plan for the long tail: per-endpoint remaining-traffic dashboards, a minimum supported mobile app version with a forced-upgrade policy, and deletion dates. Airbnb still had the Monorail serving legacy clients years later. Promising a single "off" date ignores clients you cannot control.',
        },
        {
          q: 'How do you stop the tier rule from producing 400 tiny services?',
          a: 'Size services by **concern and team ownership**, not by table. Group related services into blocks with one facade and no cycles between blocks, and review every new service against "who owns it, what data does it own, and which existing service could host this instead?". Track services per team: more than 3–5 per team is a warning sign.',
        },
      ],
      pitfalls: [
        'Jumping straight to "Kubernetes + microservices" without fixing the deploy pipeline',
        'Extracting services that still read the monolith\'s database',
        'Planning dual writes as the safety mechanism',
        'Promising a single big-bang cut-over date',
      ],
    },
    {
      id: 'prod-evolution-iq-03',
      difficulty: 'expert',
      question:
        'Two years after your SOA migration you have 400 services and 1,000 deploys a day, but a feature like "add a cancellation reason" needs changes to five services deployed in a specific order, and one host page calls a very large number of services to render. What is going on and what do you do?',
      whatInterviewerLooksFor: [
        'Recognises fan-out and an unconstrained service graph as the new coupling',
        'Proposes a second level of boundaries (blocks/facades, no cycles) rather than re-merging everything',
        'Separates data hydration (a read problem) from business workflows (a write problem)',
        'Uses measurement: graph metrics, calls per page, multi-service PR rate',
      ],
      modelAnswer: `**Diagnosis.** This is Airbnb's post-SOA state. The tiers fixed *direction* but not *fan-out* or *grouping*: services call whatever they like within the rules, cycles appear, logic is duplicated, and every presentation service re-implements hydration. Ordered deploys mean the services are not independently deployable for this feature. Two different problems are tangled together:

1. **Read/hydration:** pages need data from many entities.
2. **Write/workflow:** one business change touches many owners.

**Fix 1: service blocks (a second level of boundaries).**
- Group related services (listing, pricing, reservation) into **blocks**, each with a **facade API**.
- Clients may call only the facade, never a block's internals. **No cycles between blocks**, checked in CI from the call graph.
- This shrinks the visible graph from 400 nodes to a few dozen, and contains ordered deploys inside one team's block.

**Fix 2: platformise hydration.**
- A data-oriented GraphQL layer (Airbnb built Viaduct) where types map to owning services and batching/caching happens once (dataloaders, a per-request cache keyed by entity ID). Airbnb's listing page went from **11 calls to 1** to the listing block.

**Fix 3: workflows get one owner.**
- "Cancellation reason" belongs to the reservation block. Downstream consumers (payouts, messaging, analytics) react to a **ReservationCancelled event** with an added optional field (expand/contract), instead of being deploy-ordered.

**Measure:** cross-block calls per request, number of cycles (target 0), % of PRs/deploys that must be coordinated, p99 and error budget of aggregation pages.

**Don't:** re-merge everything into a monolith in a panic. Merging over-split services *within* a block is fine and often correct.`,
      followUps: [
        {
          q: 'Would GraphQL federation solve this by itself?',
          a: 'It solves **read composition and schema ownership**, not write workflows or cycles. You could federate a cyclic, chatty graph and just move the fan-out into the gateway\'s query plan. Do blocks and ownership first, then federation (or a central GraphQL layer like Viaduct) for hydration.',
        },
        {
          q: 'How do you detect cycles across 400 services in practice?',
          a: 'Build the graph from **tracing data** (parent → child spans aggregated daily) rather than from declared configs, because tracing captures real calls. Collapse nodes into blocks and run Tarjan\'s strongly connected components; any SCC larger than one block is a cycle. Fail CI when a new client dependency (from generated client manifests) would create one.',
        },
      ],
      pitfalls: [
        'Concluding that SOA was a mistake and proposing to go back to a monolith wholesale',
        'Adding a gateway and calling it fixed while the graph stays cyclic',
        'Treating read fan-out and write coordination as the same problem',
      ],
    },
    {
      id: 'prod-evolution-iq-04',
      difficulty: 'hard',
      question:
        'It is 2008 at a subscription company. A corruption in your single big relational database has stopped the business for three days. You are the new head of engineering. Lift-and-shift to the cloud, rebuild cloud-native, or harden the data centre? Defend your choice, including how you would know it is working.',
      whatInterviewerLooksFor: [
        'Frames the real problem as single points of failure and vertical scaling, not "on-prem vs cloud"',
        'Weighs the three options with costs and timelines',
        'Recognises that cloud-native needs resilience practices (failure injection, degradation)',
        'Defines measurable checkpoints and an incremental path',
      ],
      modelAnswer: `**The real problem:** one vertically scaled database is a single point of failure for the whole business, and growth will make it worse. Moving the same design to the cloud keeps the SPOF on rented hardware.

**Options:**
| Option | Pros | Cons |
|---|---|---|
| Harden the DC (better backups, a standby, more hardware) | Fast, low risk | Still vertical; capacity planning and buffers remain; growth limited by procurement |
| Lift-and-shift | Faster exit from DCs | Same monolith and SPOF; cloud instance failure is *more* frequent, so it gets worse |
| **Rebuild cloud-native, incrementally** | Horizontal scale, elasticity, failure isolation | Years of work; new skills; new failure modes |

**My choice:** harden now (a standby, verified restores) to stop the bleeding, and **rebuild cloud-native incrementally**, which is what Netflix did after its August 2008 outage, finishing in January 2016 after seven years.

**How I'd run it:**
- Start with stateless, customer-facing read paths; move billing and other sensitive data last, as Netflix did.
- Design for instance failure: no in-memory sessions, no chatty cross-network APIs, graceful degradation (show popular titles if recommendations are down).
- **Inject failure from day one:** a Chaos-Monkey-style terminator in business hours with engineers watching. Later: latency injection and whole-zone evacuation drills.
- **Replay real traffic** to the new stack before switching; toy load tests hid Netflix's real bottlenecks.

**Is it working?** Availability per customer journey (Netflix aimed for four nines), cost per unit of business (Netflix reported cost per streaming start fell to a fraction of the DC's), deploy frequency per team, % of traffic on the new stack, and time to recover in drills.`,
      followUps: [
        {
          q: 'The CFO says the cloud bill is higher than the DC. How do you answer?',
          a: 'Compare cost **per unit of business** (per stream start, per order), not the raw bill, and include the buffers a DC needs for peaks and growth. Netflix reported cloud cost per streaming start at a fraction of the DC\'s, thanks to elasticity. Then act: autoscaling floors, reserved/savings plans for the base load, and right-sizing. If the unit cost is genuinely higher, say so, along with what the extra spend buys (availability, deploy speed).',
        },
        {
          q: 'Why run Chaos Monkey in business hours and not at 3 a.m.?',
          a: 'The point is to learn while engineers are present and alert, so the failure is observed, fixed and turned into a permanent improvement. At 3 a.m. the same failure becomes an incident with a sleepy on-call. It also forces every team to design for instance loss continuously, instead of discovering a hidden single-instance dependency during a real outage.',
        },
      ],
      pitfalls: [
        'Assuming the cloud provider removes the single point of failure automatically',
        'Proposing a full rewrite with a big-bang cut-over',
        'Ignoring how sensitive data (billing, PII) changes the migration order',
      ],
    },
    {
      id: 'prod-evolution-iq-05',
      difficulty: 'expert',
      question:
        'Your company has 60 microservices and a single GraphQL/BFF aggregation layer owned by one 6-person team. Twenty product teams queue for it, the schema is getting inconsistent, and the team is burning out on support. What is your next architecture step?',
      whatInterviewerLooksFor: [
        'Identifies the re-monolith at the aggregation layer (ownership bottleneck)',
        'Knows federation\'s components and costs (DGSs, registry, composition, gateway query planning)',
        'Keeps a unified schema while distributing implementation',
        'A migration plan with schema governance and safety checks',
      ],
      modelAnswer: `**Diagnosis:** this is Netflix's Studio API moment. A unified graph was the right fix for duplicated aggregation code and inconsistent materialised views, but one team now owns every resolver. That team is far from the domain knowledge, manually wires every backend in, and carries all the operational load. The aggregation layer has become the monolith.

**Step: federate the graph, keep it unified.**
- **Domain graph services:** each domain team owns its subgraph and resolvers (Movie, Production, Talent, or for you Orders, Catalog, Payments). They can convert an existing microservice or add a thin GraphQL service.
- **Schema registry in CI:** every push must be valid, **compose** with all other subgraphs, and be **backward compatible**. Breaking changes need a deprecation window.
- **Gateway:** builds a query plan and fans out (parallel where possible), joining entities by key. Budget the overhead: Netflix measured about 10 ms for planning and (de)serialisation.
- **The platform team changes jobs:** from writing resolvers to owning the gateway, registry, tooling, schema review guidelines (naming, pagination, nullability) and observability per field.

**Migration:**
1. Stand up the gateway with the existing monolithic graph as one subgraph, so nothing changes for clients.
2. Move types or fields to domain subgraphs one at a time, using field-level override to route a field to its new owner. Diff responses with replay tests on sampled traffic, then use sticky canaries for behaviour that cannot be replayed (non-idempotent mutations, performance).
3. Retire the monolithic subgraph.

**Costs to state:** a stateful registry and composition rules to govern; gateway latency; N+1 across subgraphs if entity resolvers are not batched; and debugging across subgraphs, which needs per-field tracing. With 3 teams instead of 20, I would not do this; a single NestJS GraphQL server with DataLoader is simpler.`,
      followUps: [
        {
          q: 'Two teams both want to own the "price" field on Product. How does federation handle this?',
          a: 'Federation lets several subgraphs *contribute fields* to an entity, but one field has one owning subgraph (shared value types aside). The registry rejects conflicting definitions at composition time. Ownership is a governance decision: the pricing domain owns `price`, and the catalog team can expose `listPrice` if it is genuinely different. Settle it in schema review, not in the gateway.',
        },
        {
          q: 'p99 of the home screen went from 180 ms to 260 ms after moving to the gateway. Where do you look?',
          a: 'Look at the query plan depth first. Sequential hops (fetching entity keys from subgraph A, then resolving fields in B, then C) add a round trip each. Then check entity resolvers for N+1 (batched representations not loaded with one query), the gateway\'s own planning and serialisation (Netflix saw about 10 ms), and connection pooling to subgraphs. Fixes: flatten the plan by moving commonly co-requested fields into one subgraph, batch entity loads, and cache query plans.',
        },
      ],
      pitfalls: [
        'Letting every team expose its own GraphQL endpoint to clients (losing the unified schema)',
        'Federating without a registry or compatibility checks',
        'Ignoring gateway latency and cross-subgraph N+1',
      ],
    },
    {
      id: 'prod-evolution-iq-06',
      difficulty: 'hard',
      question:
        'Your CTO wants to break a 2-million-line monolith into microservices because "it is too big". Make the case for a modular monolith instead, and tell me how you would prove, with numbers, that it is working after a year.',
      whatInterviewerLooksFor: [
        'Separates codebase size from the actual pains (fragility, slow CI, onboarding)',
        'Uses Shopify\'s concrete reasoning against default microservices',
        'Proposes enforceable boundaries (domain components, declared dependencies, data ownership)',
        'Defines outcome metrics, not tool metrics',
      ],
      modelAnswer: `**Reframe:** size is not the problem. **Coupling** is: changes in one area break another, CI is slow, and new engineers need the whole system in their head. Those are the pains Shopify listed in 2016 for one of the largest Rails codebases ever.

**Why not microservices by default (Shopify's own reasons):**
- each service needs its own pipeline, infrastructure and on-call;
- teams lose easy access to data they need;
- every cross-domain call becomes a network call, with latency and partial failure;
- large refactors across services require coordinated deploys.

**The modular-monolith plan:**
1. **Componentize by business domain** (orders, shipping, billing, inventory, platform). Do it in one scripted move rather than months of drift.
2. **Declare dependencies** per component and enforce them on every PR with a static checker, with a **todo baseline** so legacy debt does not block but new debt fails.
3. **Own data:** each component owns its tables (schemas or roles); other components go through its public API or events.
4. **Invert dependencies** with events/pub-sub where the graph is cyclic (Shopify found every component depended on more than half the others).
5. Extract a service only for a **different risk or runtime profile** (PCI, a read path far hotter than writes).

**Proof after a year (outcome metrics):**
- **Change locality:** median components touched per PR going down (Shopify's metric).
- **Isolation:** N components **boot and pass their tests in isolation**. This is the milestone Shopify's 2024 retrospective says matters more than violation counts.
- **Dependency graph:** edges and cycles trending down.
- **Delivery:** CI time, lead time and change-failure rate (DORA) before vs after.
- **Fragility:** incidents caused by cross-domain side effects.

**What I'd admit:** boundary tooling is a "sharp knife". Static checks miss runtime coupling (initializers, autoloading, DI), and domain lines may not match how the code runs, so I would review the boundaries every quarter.`,
      followUps: [
        {
          q: 'The team moved all the files into components and the violation count is huge. Engineers ignore it. What now?',
          a: 'Make it **incremental and owned**: baseline every existing violation so CI is green, fail only on new ones, and give each component team a small quarterly target tied to a real outcome (for example "shipping boots without billing"). Shopify found this is a people problem first: an architecture guild, office hours and visible progress matter more than another dashboard. Start with the base/platform layer, because everything depends on it.',
        },
        {
          q: 'When would you say the modular monolith has reached its limit?',
          a: 'When **deploy contention** persists despite a good pipeline (teams routinely wait on each other\'s changes), when one component needs a **different scaling or runtime profile** that separate deployments of the same image cannot meet, or when compliance demands a hard isolation boundary. Even then, extract the components that already boot in isolation; they are the cheap ones.',
        },
      ],
      pitfalls: [
        '"Microservices are always more scalable" with no reference to team or deploy metrics',
        'Measuring success by the linter\'s violation count',
        'Ignoring data ownership and keeping every table accessible everywhere',
      ],
    },
    {
      id: 'prod-evolution-iq-07',
      difficulty: 'expert',
      question:
        'You run a multi-tenant commerce SaaS in India with 40,000 merchants on one Postgres cluster. During a celebrity brand\'s drop, their traffic saturates the primary and every other merchant\'s checkout slows down. Design the isolation, borrowing from how Shopify did it.',
      context: 'A NestJS monolith, BullMQ workers, Postgres + Redis. Sales events are announced on Instagram with an hour\'s notice.',
      whatInterviewerLooksFor: [
        'Isolates data and stateful resources per group of tenants (pods/cells), not per domain',
        'Keeps app servers stateless and shared, with routing at the edge',
        'Enforces a single-pod rule for every unit of work',
        'Has a tenant-move and failover story with downtime numbers',
        'Handles the cross-tenant features that break the rule',
      ],
      modelAnswer: `**Principle:** this is a *blast-radius* problem, not a code-structure problem. Shopify's answer was **pods**: a set of shops on fully isolated datastores, with stateless app servers and workers shared.

**Design:**
- **Pod = Postgres primary (+ replica) + Redis + queue namespace** for a group of merchants. Start with a few pods; put the biggest brands on **dedicated pods**.
- **Routing:** a tenant → pod table (in a small, highly available store, cached at the edge). An edge component (NGINX/OpenResty Lua or a NestJS middleware) resolves the shop's host to a pod and passes a header. App servers pick the right connection pool per request (AsyncLocalStorage), and jobs carry the pod ID.
- **Rule:** **one unit of work touches exactly one pod.** Loops over all merchants become per-pod jobs. Cross-merchant features (marketplace search, analytics, a shared buyer wallet) move to separate services fed by CDC or the data warehouse, because they must not read across pods synchronously.
- **Capacity:** stateless pods share the app tier, so a drop scales app servers, while the database load stays contained in one pod. Add per-pod admission control (concurrency limits on checkout per pod, a waiting room for the drop).
- **Moves and failover:** a shop mover copies data and tails WAL/logical replication, then briefly locks writes for cut-over. Shopify reported under 10 s of downtime for many stores and under 20 s for larger ones. Each pod has an active and a recovery location; Shopify's Pod Mover fails over in about a minute.

**Rollout:** first make the code pod-aware with one pod (routing table, pool-per-request, single-pod rule enforced in tests). Then add pod 2 and move a few low-risk merchants. Then move the big brands to dedicated pods before the next sale season.

**Costs:** more databases to operate, cross-pod reporting via a warehouse, migrations run per pod, and the routing table is now critical infrastructure.`,
      followUps: [
        {
          q: 'How do you run a schema migration across 12 pods safely?',
          a: 'Treat each pod as a deployment target: run expand-phase migrations pod by pod, starting with a canary pod with low-value tenants, while app code tolerates both schemas. Track per-pod migration state in a table so a failed pod can be retried or held. Only run the contract phase once every pod has completed and the old code path is gone. Never run one long transaction across pods.',
        },
        {
          q: 'A merchant is mid-move when a flash sale starts. What happens?',
          a: 'Moves should be **blocked by policy** for tenants with announced events (a move freeze window). If one is already in progress, the copy and replication phase is harmless; only the short write-lock cut-over matters. Abort or postpone the cut-over step, keep the shop on the source pod, and resume after the event. The routing table changes only after replication lag is near zero.',
        },
      ],
      pitfalls: [
        'Splitting into microservices by domain, which does not isolate one tenant from another',
        'Sharding without a single-pod rule, so shared code still fans out across shards',
        'Forgetting background jobs and caches when isolating tenants',
      ],
    },
    {
      id: 'prod-evolution-iq-08',
      difficulty: 'hard',
      question:
        'Your mobile apps (which you cannot force-upgrade) talk to a decade-old monolithic API. You want domain-owned GraphQL services behind them with zero downtime. How do you sequence and verify the migration?',
      whatInterviewerLooksFor: [
        'Decouples the client migration from the server migration',
        'Uses multiple verification techniques, each for what it can test',
        'Handles non-idempotent operations differently from reads',
        'Has rollback at each phase',
      ],
      modelAnswer: `**Sequence (Netflix's 2022 mobile migration from Falcor to GraphQL is the template):**

**Phase 1: move clients first, behind a shim.** Put a GraphQL shim on top of the existing monolithic API, so client engineers can adopt GraphQL (client caching, normalisation, query design) without waiting for backend rewrites.
- **Verify with an A/B test:** split a user segment (Netflix used 1M users) into control (old API) and treatment (GraphQL shim), and compare error rate, latency and time-to-render. Netflix found correctness issues (cache TTLs, client assumptions) and spent months fixing them before ramping. The mobile homepage reached 100% in about six months.

**Phase 2: replace the shim with domain services, field by field.**
- Use the federation gateway with field-level routing (\`@override\`) to move one field at a time to the new subgraph. Removing the directive is the rollback.
- **Replay testing:** sample live queries and run them against both the shim and the new subgraph, then diff the payloads. Expect noise (localisation, date precision, floats) and decide case by case whether to match legacy behaviour. Never replay non-idempotent mutations, and keep PII out of replay.
- **Sticky canary:** for mutations and performance, pin a set of users to the new implementation for the whole experiment and compare business metrics (plays, conversions) as well as errors.

**Phase 3: retire the shim and the monolithic API**, tracking remaining traffic per client version. Old app versions may need the legacy path until a minimum-version policy forces upgrades.

**Why three techniques:** A/B tests show coarse customer impact but not which field is wrong. Replay shows exact functional diffs but cannot test writes or performance. Sticky canaries cover writes and performance under real usage. Each has blind spots the others cover.`,
      followUps: [
        {
          q: 'Replay testing shows 0 diffs, but after cut-over a field is broken. How did that happen?',
          a: 'Replay only covers the queries and fields that were sampled; Netflix noted that untested fields remained "simply because we forgot about them". Rarely requested fields, feature-flagged paths, or inputs missing from the sample window slip through. Fix: measure **field coverage** (which schema fields appeared in replayed queries), add synthetic queries for uncovered fields, and keep per-field error metrics after cut-over.',
        },
        {
          q: 'Why not dual-run old and new APIs for every request and return whichever is faster?',
          a: 'It doubles load and cost, it is unsafe for mutations (side effects happen twice), and "faster" says nothing about correctness, so users would see inconsistent data between requests. Hedged requests make sense for idempotent reads against equivalent replicas, not for comparing two different implementations.',
        },
      ],
      pitfalls: [
        'Rewriting server and client at the same time with one cut-over',
        'Relying on a single verification technique',
        'Replaying mutations or PII-bearing queries against the new system',
      ],
    },
    {
      id: 'prod-evolution-iq-09',
      difficulty: 'hard',
      question:
        'You are the first architect at a 30-engineer Indian startup with a NestJS monolith, one Postgres and a sale day every month. The board wants "a scalable architecture" in 18 months. Give me the staged plan and the fitness functions that tell you each stage is done.',
      whatInterviewerLooksFor: [
        'A staged plan where each stage solves a measured problem',
        'Fitness functions that are automated and specific, with thresholds',
        'Separation of code coupling, runtime isolation and independent scaling',
        'Restraint: a justified first extraction, no default microservices',
      ],
      modelAnswer: `**Ground rule:** each stage starts from a measured trigger and ends when an automated fitness function is green. The thresholds below are examples to calibrate on your own data.

**Stage A: real modules (0–2 months).** Reorganise by domain (orders, payments, catalog, notifications, platform), with one public \`index.ts\` per module and declared dependencies.
- *Done when:* CI rejects new undeclared cross-module imports and new cycles; the baseline todo file only shrinks.

**Stage B: data ownership (2–6 months).** A Postgres schema and role per module; published views or APIs for cross-module reads; an outbox plus queue for side effects.
- *Done when:* the cross-schema grant query returns 0 rows outside published views, and the share of PRs touching more than 2 modules falls (say from about 35% to below 20%).

**Stage C: runtime isolation (4–9 months).** The same image deployed as \`api\`, \`workers-critical\` and \`workers-bulk\`, each with its own autoscaling and DB-pool budget; a weekly load test that floods bulk jobs.
- *Done when:* the bulk flood moves checkout p99 by less than 10%, and total DB connections stay under about 80% of \`max_connections\` at peak pod counts.

**Stage D: one justified extraction (6–12 months).** Choose by profile, e.g. payment tokenisation (PCI scope) or search (read-heavy, different datastore). Use a strangler facade, sticky ramp and shadow comparison.
- *Done when:* unexplained diff rate < 0.1% at every ramp step, the old path's traffic is 0, and its code is deleted by the agreed date.

**Stage E: aggregation (12–18 months, only if needed).** If 5+ teams queue on one BFF or GraphQL layer, consider federation with schema checks. Otherwise keep one NestJS GraphQL server with DataLoader.

**Throughout:** DORA metrics per team, cost per order, and an incident review that asks "would a boundary have contained this?".

**What I would not do:** split orders and checkout first, run Kafka before you need it, or adopt a service mesh with 3 services.`,
      followUps: [
        {
          q: 'A senior engineer says fitness functions slow the team down. How do you respond?',
          a: 'Agree on the cost and make it small: checks run in under a minute, legacy debt is baselined (no big-bang cleanup), and each rule has an owner and an escape hatch (an explicit, reviewed todo entry). Then show the payoff in incident and change-locality data: the class of "tax change broke shipping" bugs these checks prevent. If a rule produces no signal for a quarter, delete it.',
        },
        {
          q: 'Sale-day traffic is 8× normal. Which stage helps most, and why?',
          a: 'Stage C. Separate deployments let you pre-scale \`api\` and \`workers-critical\` and pause \`workers-bulk\`, and DB pool budgets stop an autoscaled fleet from exhausting Postgres connections. Module boundaries (A, B) help you ship safely; they do not add capacity. Pair it with pre-warming caches and a load-shedding order (recommendations off first, payments never).',
        },
      ],
      pitfalls: [
        'A plan that starts with Kubernetes and a service mesh',
        'Fitness functions that are wiki rules rather than automated checks',
        'No deletion date for migrated paths',
      ],
    },
    {
      id: 'prod-evolution-iq-10',
      difficulty: 'expert',
      question:
        'Your 25 microservices share an internal "platform-commons" Java/Node library (HTTP client with fallbacks, caching, auth, data loaders). Upgrading it takes a quarter, and last month a bug in its fallback logic took down the API. Netflix described exactly this. What is the problem called and how do you get out of it?',
      whatInterviewerLooksFor: [
        'Names binary coupling and operational coupling (Netflix Play API)',
        'Explains why fat clients make services a distributed monolith',
        'Proposes thin, generated clients with caller-owned resilience',
        'A migration that does not require a 25-service lockstep',
      ],
      modelAnswer: `**Name it.** Netflix's Play API talk (QCon SF 2018) describes two couplings:
- **Binary coupling:** thick shared libraries with hundreds of transitive dependencies spanning services. Upgrading becomes a coordinated release, which is a **distributed monolith** even though deploys look independent.
- **Operational coupling:** client libraries written by the *callee* team run inside the *caller's* process with heavy fallbacks and caches. A bug or a slow fallback consumes the caller's threads or memory, so a dependency can take the caller down.
They also hit language coupling (Java-only clients) and adopted the rule that "the evils of too much coupling between services are far worse than the problems caused by code duplication".

**Way out:**
1. **Split the library by kind.** Keep genuine *utilities* (logging, metrics, tracing) as a small shared library with a stable API. Move *domain client logic* out.
2. **Thin, generated clients:** IDL-first (gRPC/protobuf or OpenAPI) with generated stubs in each language. No business logic and no hidden caches in the client.
3. **Resilience owned by the caller:** timeouts, retries with budgets, bulkheads and fallback decisions live in the calling service (or the mesh), where the owner understands the impact.
4. **Data behind an abstraction:** if services embed loaders for shared datasets, move that to a materialised-view service or a data API, which avoids the data monolith Netflix also described.
5. **Migrate without lockstep:** publish the new generated client next to the old one, then migrate callers one by one with a deprecation date. Track the old library's version distribution until it reaches 0.

**Fitness functions:** maximum transitive dependency count of client packages, CI failing on new imports of the old library, and per-dependency timeout configuration present in every caller.`,
      followUps: [
        {
          q: 'Doesn\'t duplicating client code across 25 services create inconsistency?',
          a: 'The *generated* part is identical because it comes from the same IDL. What gets duplicated is policy (timeouts, fallbacks), and that should differ per caller: checkout and a recommendations widget need different timeouts. Consistency of cross-cutting concerns comes from a thin shared utilities library or the mesh, not from a fat domain client.',
        },
        {
          q: 'Where does a service mesh fit in this?',
          a: 'A mesh moves transport-level resilience (mTLS, retries, outlier detection, timeouts) out of libraries into sidecars or proxyless config, which removes another reason for fat clients. It cannot decide *business* fallbacks (show popular titles instead of personalised ones), so those stay in the caller.',
        },
      ],
      pitfalls: [
        'Fixing it with a stricter release process for the shared library',
        'Moving the same fat logic into a "client SDK service" called over the network',
        'Treating code duplication as worse than coupling in every case',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'prod-evolution-boe-1',
      question:
        'Your NestJS monolith has 60 engineers and one serial CI + deploy pipeline. Estimate how many merged PRs per day the deploy train can ship, and when it saturates, to decide between "fix the pipeline", "modularise" and "split deploy units".',
      assumptions: [
        '60 engineers × 4 merged PRs/week each, 5 working days',
        'Pipeline per deploy: 25 min CI + 20 min deploy = 45 min, strictly serial',
        'Deploy window: 10 hours/day',
        '10% of PRs fail CI or need a revert; a failed batch is bisected at about log2(batch) extra runs',
        'Headcount doubles in 12 months',
      ],
      steps: [
        { label: 'Demand', calc: '60 × 4 = 240 PRs/week ÷ 5 = 48 PRs/day' },
        { label: 'Serial capacity', calc: '600 min ÷ 45 min ≈ 13 deploys/day → one PR per deploy ships 13 of 48: the queue grows ~35/day' },
        { label: 'Batch of 4', calc: 'P(batch has a bad PR) = 1 − 0.9^4 ≈ 34%; runs/batch ≈ 1 + 0.34 × 2 = 1.7 → 13 ÷ 1.7 ≈ 7.7 batches × 4 ≈ 31 PRs/day < 48' },
        { label: 'Batch of 8', calc: 'P(fail) = 1 − 0.9^8 ≈ 57%; runs ≈ 1 + 0.57 × 3 = 2.7 → 13 ÷ 2.7 ≈ 4.8 × 8 ≈ 38 PRs/day < 48' },
        { label: 'Faster pipeline (20 min total)', calc: '600 ÷ 20 = 30 runs/day; batch 4 → 30 ÷ 1.7 ≈ 17.6 × 4 ≈ 70 PRs/day > 48 ✓' },
        { label: 'After headcount doubles', calc: 'Demand 96 PRs/day; a 20-min pipeline with batch 4 gives ~70 → saturated again' },
      ],
      answer:
        'Today the serial 45-minute pipeline ships roughly 31–38 PRs/day against 48 PRs/day of demand, even with batching, so the queue grows every day (the Airbnb "deploys blocked 15 h/week" shape). Cutting the pipeline to ~20 minutes gives ~70/day, which is enough now but not after headcount doubles (~96/day).',
      insight:
        'Batching barely helps because the failure probability compounds with batch size. Pipeline time is the lever. The cheapest big win is module-aware test selection (run only the tests of modules a PR touches), which needs enforced module boundaries first. When demand outgrows even a fast pipeline, you need independent deploy units: separate deployments per module, or services. That is a measured trigger for extraction, not a fashion.',
      followUps: [
        {
          q: 'The failure rate drops from 10% to 3% after flaky tests are fixed. Recompute the batch-of-8 throughput on the 45-minute pipeline.',
          a: 'P(batch fails) = 1 − 0.97^8 ≈ 22%; runs/batch ≈ 1 + 0.22 × 3 ≈ 1.66. That gives 13 ÷ 1.66 ≈ 7.8 batches × 8 ≈ 63 PRs/day > 48, so the train keeps up today. Fixing flakiness can matter as much as making CI faster, because the failure rate drives bisect cost. It still saturates after headcount doubles (96/day).',
        },
        {
          q: 'Module-aware test selection cuts the average CI time from 25 to 9 minutes. What is the risk, and how do you contain it?',
          a: 'You may skip tests that a change really affects through an undeclared dependency (DI, events, shared DB tables). Contain it by running the full suite on every Nth batch and nightly, by making the selection depend on the **declared dependency graph** (which your boundary checker enforces), and by treating any escaped regression as a missing declared edge to fix.',
        },
      ],
    },
    {
      id: 'prod-evolution-boe-2',
      question:
        'You are migrating GET /listings/:id from the monolith to a new listing service with Airbnb-style dual-read comparison. Estimate how long each ramp step must run and how long the whole endpoint takes, and what that implies for 40 endpoints.',
      assumptions: [
        'Endpoint traffic: 600 RPS average, 1,500 RPS peak',
        'You want to detect any diff class occurring at ≥ 0.05% of requests, with at least ~30 occurrences to see a pattern',
        'Ramp steps: 1%, 5%, 10%, 25%, 50%, 100%; each must also cover one full daily cycle (and a weekend for some)',
        'Comparison runs on the full ramp share (both paths execute for that share)',
      ],
      steps: [
        { label: 'Comparisons needed per step', calc: '30 ÷ 0.0005 = 60,000 compared requests' },
        { label: 'Time at 1%', calc: '600 × 0.01 = 6 compares/s → 60,000 ÷ 6 = 10,000 s ≈ 2.8 h' },
        { label: 'Time at 5%+', calc: '30 compares/s → ~33 min; at higher steps volume is not the constraint' },
        { label: 'Real constraint: coverage', calc: 'each step ≥ 24 h for the daily pattern → 6 steps ≈ 6 days; + 1 weekend ≈ 7–8 days' },
        { label: 'Extra load at 100% compare', calc: 'the service must take 1,500 RPS peak while the monolith still serves 1,500 → read capacity ×2 during the step' },
        { label: '40 endpoints, sequential', calc: '40 × ~8 days ≈ 320 days' },
      ],
      answer:
        'Statistical volume is reached in hours even at 1%, but covering daily and weekly patterns makes each endpoint take about 1–1.5 weeks. Forty endpoints in sequence is close to a year, and the 100% comparison step doubles read capacity needs on that path.',
      insight:
        'The migration is bounded by calendar coverage and parallelism, not traffic volume. Ramp several low-risk endpoints in parallel, group endpoints that share a data path, and migrate by attribute so clients are not blocked. Size the new service and its DB for 2× read load during comparison, and use sampling at the higher steps to cap the extra cost. Airbnb\'s 2–3 years for core functionality is consistent with this arithmetic at their scale.',
      followUps: [
        {
          q: 'The diff class you care about is 0.005%, not 0.05%. What changes?',
          a: 'You need 30 ÷ 0.00005 = 600,000 comparisons. At 1% (6/s) that is ~28 h; at 5% (30/s) ~5.6 h. Volume now matters at the lowest step, so either start at 5% (if the read is safe) or extend the 1% step past a day. Rare diffs usually come from rare inputs, so also add targeted replay of known edge cases rather than waiting for them in live traffic.',
        },
      ],
    },
    {
      id: 'prod-evolution-boe-3',
      question:
        'Your multi-tenant commerce SaaS (40,000 merchants, one Postgres primary) must survive a celebrity brand\'s drop. Size a Shopify-style pod layout: how many pods, the blast radius, and what happens to DB connections.',
      assumptions: [
        'Sale-day peak write load across all merchants: 18,000 write TPS, of which the celebrity brand alone is 4,000',
        'One Postgres primary on your chosen hardware sustains ~5,000 write TPS; plan to run at ≤ 70% (3,500)',
        'App tier: 120 stateless NestJS pods at peak, each with a pg pool of 10 per database it talks to',
        'Postgres max_connections per primary kept ≤ 500',
      ],
      steps: [
        { label: 'Shared tenants', calc: '18,000 − 4,000 = 14,000 TPS ÷ 3,500 = 4 shared pods' },
        { label: 'Dedicated pod', calc: 'Celebrity brand 4,000 TPS > 3,500 target → dedicated pod, and it still needs write reduction (queue the checkout, batch inventory updates) or bigger hardware' },
        { label: 'Total pods', calc: '4 shared + 1 dedicated = 5' },
        { label: 'Blast radius', calc: 'One shared pod down = 40,000 ÷ 4 = 10,000 merchants (25%) instead of 100%; the brand\'s drop now hurts only its own pod' },
        { label: 'Naive connections', calc: 'every app pod pools to every DB: 120 × 10 = 1,200 connections per primary > 500 ✗' },
        { label: 'With PgBouncer per pod DB', calc: '1,200 client connections → transaction pooling to ~100–150 server connections per primary ✓' },
      ],
      answer:
        'Five pods: four shared pods at about 3,500 write TPS each, plus a dedicated pod for the brand. One shared-pod failure then affects about 25% of merchants instead of everyone. Because app servers are shared and stateless, each primary would see ~1,200 connections, so you need a pooler (PgBouncer) per pod database, or lazily created, small per-pod pools.',
      insight:
        'Pods turn a platform-wide incident into a 25% (or single-brand) incident, but they multiply connection fan-out because every stateless app server can serve any pod. Plan pooling per pod from day one. The biggest tenant may exceed one primary even when isolated, so isolation must be paired with load shaping (a waiting room, a checkout queue) for drops.',
      followUps: [
        {
          q: 'Product wants a "trending across all stores" widget on every storefront. How does it fit the pod rule?',
          a: 'It cannot read across pods per request. Compute it asynchronously: each pod streams order events (CDC) to a warehouse or stream processor, a job aggregates the global top-N every minute or so, and publishes the result to a shared read-only cache that every pod\'s app servers read. The widget becomes a single cache read; slight staleness is acceptable for "trending".',
        },
        {
          q: 'Merchants grow 3× next year with the same per-merchant load. What breaks first in this layout?',
          a: 'Shared write load becomes ~42,000 TPS → 12 shared pods. Connection fan-out grows with pods × app servers, so pooler capacity and per-pod pool sizing break before any single DB does. Operational load also grows: migrations across 13+ pods, and pod moves for rebalancing. Invest in automated pod provisioning, per-pod migration tooling and a shop mover before then.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'prod-evolution-mcq-01',
      difficulty: 'medium',
      question:
        'At the 25% dual-read step for a new listing data service, 0.3% of comparisons differ, and almost every diff is on a listing edited in the previous two seconds. The service\'s store is fed from the monolith DB by CDC. What is the most likely explanation and the right next step?',
      options: [
        'CDC replication lag: compare again after a short delay (or skip rows updated inside the lag window) and track lag as its own metric before ramping',
        'A bug in the service\'s read logic: roll back to 1% and rewrite the query before going any further',
        'The comparator is non-deterministic: disable comparison for this endpoint and rely on canary error rates instead',
        'The monolith\'s ORM cache is stale: flush it on every write so both paths read the same value',
      ],
      correct: [0],
      explanation:
        'Diffs that cluster on just-edited rows point to the copy being behind the source, not to wrong logic. Re-checking after the lag window (or excluding recently updated rows from the diff count while measuring lag) separates freshness from correctness. Rolling back assumes a logic bug that the pattern does not show. Turning comparison off throws away the safety net. Flushing the monolith cache does not explain why the *service* is stale.',
      followUps: [
        {
          q: 'Once you flip reads to 100% service, users who edit a listing sometimes see the old title on the next page. What do you add?',
          a: 'A read-your-writes guarantee for the writer. Either route that user\'s reads for that listing to the source of truth for a few seconds after a write (a session marker or a version token), or make the write go through the service so its own store is updated synchronously. The monolith keeps writing only until write ownership flips, and that flip is the real fix.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-02',
      difficulty: 'hard',
      question:
        'This manifest is checked by an Airbnb-style tier rule (calls must go strictly downward: presentation > middle > derived > data). Which entry is the violation?',
      code: {
        language: 'typescript',
        title: 'services.manifest.ts',
        code: `export const services = [
  { name: 'trip-presentation',   tier: 'presentation', calls: ['booking-validation', 'home-demand'] },
  { name: 'booking-validation',  tier: 'middle',       calls: ['reservation-data', 'pricing-data'] },
  { name: 'home-demand',         tier: 'derived',      calls: ['home-data', 'booking-validation'] },
  { name: 'reservation-data',    tier: 'data',         calls: [] },
  { name: 'pricing-data',        tier: 'data',         calls: [] },
  { name: 'home-data',           tier: 'data',         calls: [] },
];`,
      },
      options: [
        'trip-presentation calling two different tiers (middle and derived) in one request',
        'booking-validation calling two data services, which should be merged',
        'home-demand (derived) calling booking-validation (middle), an upward call',
        'None: the rule only forbids data services calling anything',
      ],
      correct: [2],
      explanation:
        'A derived-data service calling a middle-tier service goes up the stack, which is exactly what the rule forbids, and it can create cycles (middle → derived → middle). A presentation service may call any lower tier, including several tiers at once. A middle-tier service calling two data services is the intended use: shared logic over disparate data. The rule constrains every tier, not just the data tier.',
      followUps: [
        {
          q: 'home-demand genuinely needs a validation rule that lives in booking-validation. How do you fix the dependency without breaking the rule?',
          a: 'Move the rule down if it is about data validity (into the relevant data service or a shared validation library with no I/O), or invert the flow. booking-validation can publish an event, or pass the computed value into home-demand\'s inputs. If neither fits, the two belong in the same block or tier, which is a sign the boundary was drawn wrongly.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-03',
      difficulty: 'expert',
      question:
        'Eighteen months after splitting a monolith into services, which observations suggest the system has re-formed a monolith at the orchestration or aggregation layer? Select ALL that apply.',
      options: [
        'Most feature PRs touch the one API/BFF service, and its team has a two-sprint backlog of requests from other teams',
        'Each domain team deploys its own service several times a day without coordination',
        'Several product teams have built their own single-use aggregation code because the shared layer is too slow to change',
        'The aggregation service loads multiple full datasets into memory but reads only a small fraction per request',
        'The gateway applies authentication and routing rules published by teams as data',
      ],
      correct: [0, 2, 3],
      explanation:
        'A single team queue on the API layer (Netflix\'s "return of the monolith" at NCCP, and later the Studio API bottleneck), duplicated single-use aggregation layers, and a "data monolith" loaded in memory (the Netflix Play API) are all re-monolith signs. Independent deploys per team are the healthy outcome. A gateway that applies team-published routing rules (Zuul self-service routing) centralises cross-cutting concerns without centralising business logic.',
      followUps: [
        {
          q: 'Which single metric would you put on a dashboard to catch this early?',
          a: 'The share of merged feature PRs (or deploys) that touch the aggregation service, ideally split by the team that authored them. A rising share authored by *other* teams means the layer is becoming a shared bottleneck. Pair it with lead time for changes to that service; when lead time there exceeds the domain services\' lead time, plan federation or move logic to the domain owners.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-04',
      difficulty: 'hard',
      question:
        'Your platform team wants to rewrite the company\'s blocking API gateway on an async, event-loop stack, promising a 40% CPU saving. The gateway terminates TLS, decrypts payloads, compresses responses and computes per-request metrics. Based on what Netflix reported for Zuul 2, what should you expect?',
      options: [
        'A large CPU saving, because event loops avoid context switching for every request',
        'Little efficiency gain for this CPU-heavy workload; the real benefit is cheap connections (e.g. for push or long-lived connections), at the cost of harder debugging',
        'Worse throughput, because async systems cannot use more than one core',
        'No change in either efficiency or connection capacity, because the bottleneck is always the backend',
      ],
      correct: [1],
      explanation:
        'Netflix saw no significant efficiency gain on its CPU-heavy API-fronting Zuul cluster, and about 25% more throughput with 25% less CPU only on the light logging cluster. The main win was connection scaling. The 40% promise ignores that crypto and compression dominate the cost. Async stacks use one event loop per core, so they are not single-core. And connection capacity does change dramatically, which is the point of the rewrite.',
      followUps: [
        {
          q: 'Netflix also hit thread-local assumptions in shared libraries. Why do they break under async, and what is the Node.js analogue?',
          a: 'In a blocking server one thread serves one request, so thread-locals hold request context (user, trace ID). On an event loop many requests share a thread, so thread-local context leaks between requests. In Node the analogue is a module-level variable holding "the current request". The fix is explicit context propagation: `AsyncLocalStorage` in Node, or passing a context object.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-05',
      difficulty: 'expert',
      question:
        'A gateway runs three independent canaries (search-v2, playback-v2, profile-v2), each at 10% of users and each using the bucketing below. Users complain that a small group is "always broken". What is the design flaw?',
      code: {
        language: 'typescript',
        title: 'canary bucketing',
        code: `import { createHash } from 'node:crypto';

function bucket(userId: string): number {
  return createHash('sha1').update(userId).digest().readUInt16BE(0) % 100;
}

export function useCanary(rule: { percent: number }, userId: string): boolean {
  return bucket(userId) < rule.percent;
}`,
      },
      options: [
        'SHA-1 is too slow for per-request hashing and adds latency at the gateway',
        'readUInt16BE(0) % 100 is biased, so some buckets get noticeably more users than 10%',
        'The bucket ignores the rule, so the same 10% of users land in every canary at once; exposure is correlated instead of independent',
        'Sticky bucketing should never be used for canaries; per-request randomness is safer',
      ],
      correct: [2],
      explanation:
        'Because the hash input is only the userId, a user in bucket 0–9 is in every 10% canary simultaneously, so one unlucky group absorbs every experiment\'s bugs and the canaries confound each other\'s metrics. Salting with the rule ID (hash(ruleId + userId)) makes exposures independent. SHA-1 on a short string costs microseconds. The modulo bias over 65,536 values is about 0.1% and negligible. Per-request randomness breaks stickiness and makes multi-request flows flip between versions.',
      followUps: [
        {
          q: 'You need two canaries to be mutually exclusive (a user must never be in both). How do you bucket?',
          a: 'Use one shared salt for that **experiment layer** and allocate disjoint bucket ranges: search-v2 gets buckets 0–9 and playback-v2 gets 10–19 from the same hash. Independent experiments use different salts; mutually exclusive ones share a layer and split its range. That is the layering model most A/B platforms use.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-06',
      difficulty: 'hard',
      question:
        'After a three-day outage caused by a corrupted central database, a team proposes a quick lift-and-shift of the same monolith and database onto cloud VMs. Using Netflix\'s 2010 lessons, which is the strongest objection?',
      options: [
        'Cloud VMs are always more expensive than owned hardware, so the move cannot pay off',
        'The design assumes reliable individual hardware and a fast, low-variance network (in-memory sessions, chatty APIs); in the cloud, instance loss and latency variance are normal, so the same design gets less reliable',
        'Relational databases cannot run on cloud VMs, so a NoSQL migration must come first',
        'Lift-and-shift is fine, but only if it is done region by region',
      ],
      correct: [1],
      explanation:
        'Netflix\'s "5 Lessons" post says that in its data centres in-memory session state and chatty remote APIs were acceptable, but in AWS higher instance failure and variable network latency forced a redesign. Moving the same design keeps the single point of failure and adds failure modes. Cost per unit actually fell for Netflix. Relational databases run fine in the cloud. Doing it region by region does not fix the design assumptions.',
      followUps: [
        {
          q: 'What is the smallest first slice you would move, and why that one?',
          a: 'A stateless, customer-facing read path with a natural degradation (e.g. browse or recommendations, which can fall back to a popular list). It exercises the new platform with real traffic, tolerates failure, and keeps sensitive state (billing, PII) in place until the security and data paths are proven. Netflix moved billing and employee/customer data last.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-07',
      difficulty: 'medium',
      question:
        'After moving to Kubernetes with an aggressive autoscaler, users of a NestJS app are randomly logged out several times a day. Sessions are stored in a Map inside each pod. What is the root problem, in the spirit of Netflix\'s "fail constantly" lesson?',
      options: [
        'The autoscaler is misconfigured; pinning a minimum replica count will fix it',
        'Sticky sessions on the load balancer are missing; enabling them solves it permanently',
        'The app assumes individual instances are long-lived; state must move out of the process (e.g. Redis or signed tokens) so killing any pod is harmless, and that should be continuously tested',
        'Kubernetes is not suitable for stateful apps; move the app back to fixed VMs',
      ],
      correct: [2],
      explanation:
        'Netflix found that in-memory session state, fine in a data centre with rare hardware failure, breaks when instances are disposable, and it built Chaos Monkey to keep that assumption tested. A minimum replica count and sticky sessions only reduce how often pods die or move users; deploys, node failures and scale-in still lose sessions. Moving back to VMs avoids the symptom and keeps the fragility.',
      followUps: [
        {
          q: 'How would you add a lightweight "chaos" check to this team\'s pipeline?',
          a: 'In a staging environment with realistic sessions, run an automated test that logs a user in, deletes the pod serving them (`kubectl delete pod` or a chaos tool), then asserts that the next request is still authenticated. Later, run the same pod-kill experiment in production during business hours on a small scale, with alerts watched. The goal is that instance loss is routine, not an incident.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-08',
      difficulty: 'expert',
      question:
        'A federated GraphQL schema registry checks each subgraph push for validity, composition and backward compatibility. Which of these pushes should it reject? Select ALL that apply.',
      code: {
        language: 'graphql',
        title: 'proposed changes (each line is a separate push)',
        code: `# (A) talent-dgs: delete the cast field (gateway logs show clients still query it)
type Movie @key(fields: "movieId") {
  movieId: ID!
}

# (B) movie-dgs: make an existing argument required (was: first: Int = 10)
type Query {
  movies(first: Int!, after: String): [Movie!]!
}

# (C) production-dgs: add a new nullable field
type Movie @key(fields: "movieId") {
  movieId: ID!
  budgetBand: String
}

# (D) billing-dgs: define Movie with a DIFFERENT key that no other subgraph provides
type Movie @key(fields: "internalSku") {
  internalSku: ID!
  costCentre: String
}`,
      },
      options: [
        '(A) removing a field that live clients still query',
        '(B) changing an optional argument with a default into a required one',
        '(C) adding a new nullable field to an entity',
        '(D) declaring the entity with a key the other subgraphs cannot provide, so the gateway cannot join it',
      ],
      correct: [0, 1, 3],
      explanation:
        '(A) and (B) are breaking changes: existing queries fail, either because the field no longer exists or because the now-required argument is missing. (D) cannot be resolved: the gateway joins entities by representations other subgraphs can supply, and no one else provides internalSku, so composition or query planning fails for that field. (C) is additive and backward compatible, which is the normal way schemas evolve.',
      followUps: [
        {
          q: 'The talent team really does need to remove `cast`. How do they do it safely?',
          a: 'Expand/contract: add the replacement field, mark `cast` with `@deprecated(reason: ...)`, and use field-level usage metrics from the gateway to find the clients still requesting it. Contact those owners and wait for app versions below the minimum supported version to age out. Only remove the field once its usage is zero for an agreed window. The registry\'s compatibility check should consult real usage, not just the schema diff.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-09',
      difficulty: 'hard',
      question:
        'A federated gateway resolves this query. The gateway adds ~10 ms of planning and serialisation (as Netflix reported), each subgraph call takes ~20 ms, and calls only run in parallel when they do not depend on each other\'s results. Roughly what latency should you expect, before network jitter?',
      code: {
        language: 'graphql',
        title: 'client query and ownership',
        code: `# movies     -> owned by movie-dgs (root field)
# production -> owned by production-dgs (needs Movie keys)
# talent     -> owned by talent-dgs (needs Movie keys)
# vendors    -> owned by vendor-dgs (needs Production keys)
query {
  movies(first: 10) {
    title
    production { shootingLocation vendors { name } }
    talent { name }
  }
}`,
      },
      options: [
        '~30 ms: one parallel fan-out to all four subgraphs plus gateway overhead',
        '~70 ms: movie (20) → production ∥ talent (20) → vendors (20) + 10 ms gateway',
        '~90 ms: four sequential subgraph calls plus gateway overhead',
        '~50 ms: movie (20) → everything else in parallel (20) + 10 ms gateway',
      ],
      correct: [1],
      explanation:
        'The plan has three dependent levels: movies first (to get keys), then production and talent in parallel (both need only Movie keys), then vendors (which needs Production keys). That is 3 × 20 ms + 10 ms ≈ 70 ms. Option A ignores the key dependencies. Option C serialises production and talent unnecessarily. Option D forgets that vendors depends on production\'s result.',
      followUps: [
        {
          q: 'The client team wants this under 45 ms. Which change is most effective?',
          a: 'Remove a dependent level. For example, let production-dgs resolve the vendor names it already knows (contribute `vendors { name }` from the subgraph that holds the Production → vendor relation), or denormalise vendor names into production\'s store. That turns three levels into two (~50 ms). Caching the query plan and batching entity lookups shaves a few more ms, but depth is the dominant cost.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-10',
      difficulty: 'hard',
      question:
        'Your NestJS "shipping" module reports zero boundary violations from your static import checker, yet booting it alone in a test (with only its declared dependencies) fails. Which causes are plausible? Select ALL that apply.',
      options: [
        'A global provider or app-level initializer in another module registers something shipping relies on at runtime',
        'Shipping resolves a dependency through a DI string token or ModuleRef.get() that the import checker never sees',
        'A TypeORM entity in shipping has a relation to an entity owned by billing, loaded via the global entity glob',
        'The static checker counted type-only imports as violations',
        'Shipping reads another module\'s config namespace from a shared ConfigService registered at the root',
      ],
      correct: [0, 1, 2, 4],
      explanation:
        'Static import checks miss runtime coupling: global providers and initializers, DI by token or ModuleRef, ORM relations wired through a global entity list, and shared configuration. Shopify\'s Packwerk retrospective lists the same blind spots (initializers, autoload/require), and found that code booting in isolation was the real milestone. Counting type-only imports would *add* violations, not hide them, so it cannot explain a clean report.',
      followUps: [
        {
          q: 'How do you make "boots in isolation" a fitness function for every module?',
          a: 'Generate one spec per module that builds `Test.createTestingModule({ imports: [ThatModule, ...declaredDeps] })` from the same `boundaries.json` your import checker uses, with only that module\'s entities registered, and runs its smoke tests. Run the specs in CI in parallel. A module whose spec is not green is not "componentized", regardless of its violation count.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-11',
      difficulty: 'expert',
      question:
        'In a Shopify-style pod architecture, a nightly job in the shared worker fleet loops over every shop, queries its pod, and writes a platform-wide "top sellers" table. During last night\'s run one pod was failing over, and the whole job crashed and retried for hours, adding load to every pod. What is the best redesign?',
      options: [
        'Add a try/catch around each shop so the loop skips failures and continues',
        'Run the loop on a read replica of each pod to remove the load concern',
        'Fan out one job per pod that computes partial results and emits them (or uses CDC to a warehouse); a separate aggregator combines whatever pods have reported, so no unit of work spans pods',
        'Move the job to the largest pod so it has enough capacity to query the others',
      ],
      correct: [2],
      explanation:
        'Pods rely on the rule that one unit of work touches one pod; a cross-pod loop recreates the problem Shopify had after sharding, where one bad shard broke a platform-wide action. Per-pod partial jobs plus an aggregator (or a warehouse fed by CDC) isolate failures and let the job finish with N−1 pods. try/catch keeps a long cross-pod transaction-like loop and its retry storms. Replicas only reduce load. Hosting the job in one pod still reaches across pods.',
      followUps: [
        {
          q: 'The aggregator runs while one pod has not reported. Publish or wait?',
          a: 'Publish with explicit staleness: merge the latest partial result for the missing pod (marked with its timestamp), or publish without it if the data is advisory like "top sellers". Alert if a pod\'s partial is older than a threshold. For financial aggregates (payouts, tax), wait and block downstream steps instead, because completeness matters more than freshness there.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-12',
      difficulty: 'medium',
      question:
        'In your monolith, a change to tax calculation broke shipping-rate quotes in production. An engineer proposes splitting tax and shipping into separate microservices "so this can never happen again". Which response best reflects the modular-monolith reasoning Shopify published?',
      options: [
        'Agree: network boundaries are the only reliable way to stop cross-domain breakage',
        'Fix the coupling in place: give tax a public API, make shipping depend only on it, enforce the dependency in CI and add a contract test; extract later only if tax needs a different runtime or risk profile',
        'Keep the code as is but add more end-to-end tests covering tax and shipping together',
        'Merge tax and shipping into one module, since they clearly change together',
      ],
      correct: [1],
      explanation:
        'Shopify\'s own example was a tax change breaking shipping rates, and its answer was enforced boundaries inside one app: public APIs, declared dependencies and static checks. That avoids per-service pipelines, network latency and coordinated refactors. A network split does not remove the logical dependency; shipping would still call tax, now over a network. More end-to-end tests detect breakage late without reducing coupling. Merging hides two domains that change for different reasons.',
      followUps: [
        {
          q: 'What contract test would have caught the original breakage?',
          a: 'A consumer-driven test owned by shipping against tax\'s public API: given a fixed set of addresses and carts, tax\'s `quote()` returns amounts with a documented shape and rounding (e.g. integer paise, inclusive vs exclusive of GST). It runs in tax\'s CI, so a tax change that alters what shipping relies on fails *before* merge, in the team that made the change.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-13',
      difficulty: 'hard',
      question:
        'This shop-move cut-over runs when moving a tenant between pods. Occasionally a few orders placed during the move are missing on the destination. Which change fixes it?',
      code: {
        language: 'typescript',
        title: 'shop-mover.ts (cut-over step)',
        code: `async function cutOver(shopId: string, src: Pod, dst: Pod) {
  await replication.waitUntilLagBelow(shopId, src, dst, 2_000); // ms
  await routing.set(shopId, dst.id);        // new requests now go to dst
  await locks.acquireWriteLock(shopId);     // block writes for the shop
  await replication.drain(shopId, src, dst);
  await locks.releaseWriteLock(shopId);
  await replication.stop(shopId, src, dst);
}`,
      },
      options: [
        'Lower the lag threshold from 2,000 ms to 100 ms before flipping routing',
        'Acquire the write lock first, drain replication to zero lag, verify, then flip routing and release the lock',
        'Flip routing first but keep replication running for an hour afterwards',
        'Make the destination pod read from the source pod until replication stops',
      ],
      correct: [1],
      explanation:
        'Routing flips while the source can still accept writes (the lock comes after the flip) and while up to 2 s of changes are in flight, so writes land on the source after the drain or are never copied. The safe order is: lock writes on the source, drain to zero lag, verify (counts or checksums), switch routing, then release. A lower threshold only narrows the race. Keeping replication on after the flip lets the two pods diverge. Cross-pod reads break the single-pod rule.',
      followUps: [
        {
          q: 'The write lock lasts 8 s for large shops. How do clients experience it, and how do you keep it short?',
          a: 'Writes during the lock should get a fast, retryable error (e.g. 503 with Retry-After, or a queued checkout) rather than hanging. Keep the window short by making the drain small: wait for near-zero lag *before* locking, so the locked drain only covers the last moments, and verify with cheap per-table row counts or watermarks rather than full checksums. Shopify reported under 10 s for many stores and under 20 s for larger ones.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-14',
      difficulty: 'expert',
      question:
        'You are ramping traffic from a monolith endpoint to a newly extracted service behind a strangler facade. Which practices make each ramp step genuinely reversible? Select ALL that apply.',
      options: [
        'The monolith remains the single write owner until a separate, explicit ownership flip; the new service is fed by an outbox or CDC stream',
        'Routing and ramp percentage live in a runtime flag with a kill switch, not in a deploy',
        'The old code path is deleted as soon as the service reaches 50%, to prevent drift',
        'Users are bucketed stickily, so a rollback moves a known cohort back rather than random requests',
        'Writes go synchronously to both the monolith and the service so either can take over instantly',
      ],
      correct: [0, 1, 3],
      explanation:
        'A single write owner keeps one source of truth, so rolling reads back loses nothing. A runtime flag with a kill switch makes the rollback a seconds-long config change. Sticky cohorts make the impact and the rollback understandable. Deleting the old path at 50% removes the rollback target. Synchronous dual writes diverge on partial failure, which is why Airbnb compared writes using a shadow database instead.',
      followUps: [
        {
          q: 'When exactly is it safe to delete the old path?',
          a: 'After write ownership has flipped and been stable through at least one full business cycle (including a peak such as a sale day), after old-path traffic per client version has reached zero (or the remaining clients are below the supported minimum), and once the comparison or diff dashboards have been quiet for the agreed window. Put the deletion date in the migration plan up front; otherwise the long tail lives for years.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-15',
      difficulty: 'hard',
      question:
        'A 12-engineer Bengaluru fintech has one NestJS product. Card data must stay in a small, audited PCI scope; a KYC OCR step is CPU/GPU-heavy and spikes during onboarding campaigns; everything else is ordinary CRUD. Which architecture fits best?',
      options: [
        'Full microservices per domain (users, KYC, cards, ledger, notifications) behind a gateway from day one',
        'A modular monolith for the product, plus a separately deployed card-vault service (PCI scope) and a separately scaled OCR worker pool fed by a queue',
        'A pure monolith with no module boundaries, scaled vertically during campaigns',
        'GraphQL federation with one subgraph per domain so teams can move independently',
      ],
      correct: [1],
      explanation:
        'Extract only what has a different risk or runtime profile: card data for compliance scope (as Shopify did with CardSink/CardServer) and OCR for its compute and scaling profile. Keep the rest as a modular monolith that 12 engineers can move fast in. Full microservices would multiply pipelines and on-call for a tiny team. A boundary-less monolith keeps PCI scope huge and couples OCR spikes to the API. Federation solves a many-teams API-ownership problem this team does not have.',
      followUps: [
        {
          q: 'The OCR worker is in Python while the app is NestJS. How do they communicate, and what happens during a campaign spike?',
          a: 'Through a queue (e.g. SQS, or a Redis/BullMQ-compatible protocol, or Kafka): the API enqueues a job with the document reference (object-storage key, not the bytes) and returns "verification in progress". Python workers autoscale on queue depth, and results come back as an event or webhook that the KYC module consumes idempotently. A spike lengthens the queue (visible as a status in the user\'s flow) instead of raising API latency.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-16',
      difficulty: 'expert',
      question:
        'This CI step is meant to stop new module-boundary violations while tolerating legacy ones. After three months the baseline file is unchanged, yet several new violations have merged. Why?',
      code: {
        language: 'typescript',
        title: 'ci/boundaries-gate.ts',
        code: `const found: string[] = checkBoundaries();               // e.g. 'src/a.ts -> orders [dependency]'
const baseline: string[] = JSON.parse(readFileSync('boundaries.todo.json', 'utf8'));

if (found.length > baseline.length) {
  console.error('New boundary violations introduced');
  process.exit(1);
}
console.log('OK:', found.length, 'violations (baseline', baseline.length + ')');`,
      },
      options: [
        'JSON.parse returns the entries in a different order, so the comparison is unreliable',
        'Comparing counts lets a new violation merge whenever someone fixes an old one; the gate must compare entries (new ∖ baseline) and also flag fixed-but-still-listed entries',
        'The gate should fail when found.length is less than the baseline, because that indicates the checker missed files',
        'checkBoundaries() must be run twice to avoid flaky results from file-system ordering',
      ],
      correct: [1],
      explanation:
        'A count-based gate is gameable: fixing one old violation creates room for one new one, so the total stays flat while new debt merges. Comparing sets (new entries fail) and requiring stale entries to be removed keeps the baseline honest, which is the todo-file hygiene Shopify\'s Packwerk retrospective called out. Ordering does not matter for a count. A shrinking count is the goal, not a failure. Static analysis is deterministic, so running it twice achieves nothing.',
      followUps: [
        {
          q: 'A refactor moves a file, and 40 baselined entries now show as "new" with a different path. How do you avoid punishing the refactor?',
          a: 'Key entries by something stable across moves, e.g. (source module, target module, imported symbol) rather than file path, or let the refactor PR regenerate the baseline (`--update-todo`) with an automated check that the **count per (source, target) pair did not increase**. The rule becomes "no new edges and no growth per edge", which tolerates moves but not new coupling.',
        },
      ],
    },
    {
      id: 'prod-evolution-mcq-17',
      difficulty: 'expert',
      question:
        'Your services are grouped into blocks, each with a facade, and the rule is that clients may call only a block\'s facade. The checkout team now calls the pricing block\'s internal rate-cache service directly, "to save 8 ms". What is the most important consequence to raise?',
      options: [
        'The 8 ms saving is not worth the extra network hop through the facade, so the change is fine',
        'The pricing team can no longer change, split or replace its internal services without breaking checkout, which re-creates the tangled graph that blocks were introduced to prevent',
        'Direct calls bypass TLS, so this is primarily a security issue',
        'It will create a circular dependency between checkout and pricing',
      ],
      correct: [1],
      explanation:
        'Blocks exist so internal services can evolve behind a stable facade. Airbnb introduced them after unconstrained calls produced a tangled graph with cycles. A direct call couples checkout to an internal detail, so any change in pricing\'s internals becomes a cross-team, ordered deploy. Option A misreads the trade (the coupling cost is the issue, not the hop). Internal calls are usually still mTLS. One direct call does not by itself create a cycle.',
      followUps: [
        {
          q: 'The 8 ms really matters for checkout p99. How do you meet the need without breaking the rule?',
          a: 'Make the facade fast for this use case: add a batched or cached endpoint on the facade (e.g. `getRates` for a whole cart in one call), co-locate the facade with its cache, or publish rates as events so checkout keeps a local read model it owns. If checkout keeps needing pricing internals, revisit the block boundary itself; maybe rate caching belongs at the facade.',
        },
      ],
    },
  ],
};

export default topic;
