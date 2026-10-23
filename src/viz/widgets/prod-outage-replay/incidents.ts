// Outage timelines for prod-dissections. Every fact and number below is taken from the topic's
// own text (src/content/topics/prod-dissections.ts). The "with the guard" branches are marked as
// our illustration: they replay the fix each company announced, and are not part of any postmortem.

export type NodeState = 'ok' | 'warn' | 'down' | 'change' | 'off';
export type Phase = 'trigger' | 'spread' | 'detect' | 'mitigate' | 'recover' | 'lesson' | 'what-if';

export interface DNode {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
}

export interface Step {
  time: string;
  phase: Phase;
  text: string;
  /** node states that change at this step (others keep their previous state) */
  set?: Record<string, NodeState>;
  /** short impact line for the impact tile */
  impact?: string;
}

export interface Incident {
  id: string;
  label: string;
  when: string;
  section: string;
  shape: string;
  nodes: DNode[];
  edges: [string, string][];
  steps: Step[];
  guard: { label: string; branchAfter: number; steps: Step[] };
}

export const INCIDENTS: Incident[] = [
  {
    id: 'github-2018',
    label: 'GitHub 2018',
    when: '21–22 Oct 2018 (UTC)',
    section: '§1',
    shape: 'Automation did what it was told, fast and everywhere',
    nodes: [
      { id: 'hub', label: 'East hub ↔ East DC', sub: 'network link', x: 95, y: 40 },
      { id: 'east', label: 'East DC', sub: 'MySQL primaries', x: 95, y: 130 },
      { id: 'orch', label: 'Orchestrator', sub: 'Raft quorum', x: 300, y: 40 },
      { id: 'west', label: 'West Coast DC', sub: 'replicas', x: 505, y: 130 },
      { id: 'apps', label: 'East app servers', x: 300, y: 200 },
      { id: 'hooks', label: 'Webhooks & Pages', x: 505, y: 40 },
    ],
    edges: [
      ['hub', 'east'],
      ['orch', 'east'],
      ['orch', 'west'],
      ['apps', 'east'],
      ['apps', 'west'],
      ['east', 'west'],
    ],
    steps: [
      { time: '22:52', phase: 'trigger', text: 'Routine maintenance to replace failing 100G optical equipment cuts the link between the East Coast network hub and the primary East Coast data center. Connectivity is back in 43 seconds.', set: { hub: 'down' }, impact: '43 s partition' },
      { time: '22:52', phase: 'spread', text: 'In that window the Orchestrator nodes in the West Coast and the public-cloud East form a Raft quorum and promote West Coast primaries. GitHub\'s write-up says Orchestrator "behaved as configured".', set: { hub: 'ok', orch: 'change', west: 'change' }, impact: 'primaries moved West' },
      { time: '22:52+', phase: 'spread', text: 'The East primaries had accepted a few seconds of writes that never replicated west (954 writes on one of the busiest clusters). Then the West Coast takes writes for nearly 40 minutes: each side has writes the other lacks.', set: { east: 'warn', west: 'warn' }, impact: 'divergent writes on both coasts' },
      { time: '23:13', phase: 'detect', text: 'East Coast application servers cannot cope with a cross-country round trip on most database calls, so the site degrades. Status goes red.', set: { apps: 'down' }, impact: 'site degraded, status red' },
      { time: '23:19', phase: 'mitigate', text: 'Webhooks and Pages builds are paused to protect the data.', set: { hooks: 'off' }, impact: 'webhooks + Pages paused' },
      { time: '00:05', phase: 'mitigate', text: 'Neither side is a superset of the other, so there is no clean failback. GitHub fails forward to protect integrity: recovery from backups begins (taken every 4 hours, multiple TB in remote public-cloud blob storage, so restores take hours).', set: { east: 'down' }, impact: 'restoring from backups' },
      { time: '11:12', phase: 'recover', text: 'All primaries are back in the East.', set: { east: 'ok', west: 'ok', orch: 'ok', apps: 'warn' }, impact: 'primaries back East' },
      { time: '23:03 (22 Oct)', phase: 'recover', text: 'Status green after 24 h 11 min. The backlog was over 5 million webhook events and 80,000 Pages builds; about 200,000 webhook payloads outlived an internal TTL and were dropped.', set: { apps: 'ok', hooks: 'ok' }, impact: '24 h 11 min degraded' },
      { time: 'after', phase: 'lesson', text: 'Orchestrator was reconfigured never to promote primaries across regional boundaries. A failover detector must distinguish "primary dead" from "I can\'t see the primary", and restore time is dominated by download and decompress, so measure it.', impact: 'no cross-region auto-promotion' },
    ],
    guard: {
      label: 'No cross-region promotion',
      branchAfter: 0,
      steps: [
        { time: 'what-if', phase: 'what-if', text: 'With the rule GitHub adopted (never promote primaries across regions), the West + cloud-East quorum would not have moved the primaries. The East primaries keep their role.', set: { hub: 'down', orch: 'ok' }, impact: 'primaries stay East' },
        { time: 'what-if', phase: 'what-if', text: 'The link returns after 43 s, so writes stay on one side and there is nothing to reconcile. The cost is that a real East outage now needs a human decision to fail over across regions.', set: { hub: 'ok' }, impact: 'no divergence to restore' },
      ],
    },
  },
  {
    id: 'cloudflare-2019',
    label: 'Cloudflare 2019',
    when: '2 Jul 2019 (UTC)',
    section: '§7',
    shape: 'Automation did what it was told, fast and everywhere',
    nodes: [
      { id: 'ci', label: 'Engineer + CI', sub: 'tests pass', x: 95, y: 40 },
      { id: 'qs', label: 'Quicksilver', sub: 'global push, p99 2.29 s', x: 300, y: 40 },
      { id: 'rule', label: 'WAF rule', sub: '.*(?:.*=.*)', x: 505, y: 40 },
      { id: 'edge', label: 'Edge CPUs', sub: 'HTTP/HTTPS, worldwide', x: 300, y: 130 },
      { id: 'guard', label: 'CPU-excess guard', sub: 'removed in a refactor', x: 505, y: 130 },
      { id: 'tools', label: 'Internal tools', x: 95, y: 200 },
    ],
    edges: [
      ['ci', 'qs'],
      ['qs', 'rule'],
      ['rule', 'edge'],
      ['guard', 'edge'],
      ['tools', 'edge'],
    ],
    steps: [
      { time: '13:31', phase: 'trigger', text: 'An engineer merges a "minor change" to the XSS detection rules. At 13:37 CI builds it and the tests pass.', set: { ci: 'change', guard: 'off' }, impact: 'rule change merged' },
      { time: '13:42', phase: 'spread', text: 'Automatic global deploy through Quicksilver. Unlike software releases, WAF rules were allowed to go global by design. The rule was meant to run in simulate mode, but simulate rules still execute.', set: { qs: 'change', rule: 'change' }, impact: 'rule on every edge server' },
      { time: '~13:45', phase: 'detect', text: 'First page. CPUs serving HTTP/HTTPS reach nearly 100% across the network; one leader reported losing 80% of traffic. The pattern .*(?:.*=.*) backtracks catastrophically, and the CPU guard that would have limited it was gone.', set: { rule: 'down', edge: 'down' }, impact: '~100% CPU worldwide' },
      { time: '14:00–14:07', phase: 'mitigate', text: 'The WAF is identified at 14:00; a "global terminate" is proposed at 14:02 and executed at 14:07. Impaired access to internal tools slowed this.', set: { tools: 'warn', rule: 'off' }, impact: 'global WAF kill' },
      { time: '14:09', phase: 'recover', text: 'Traffic and CPU are back to normal: 27 minutes of outage. The WAF is re-enabled globally at 14:52.', set: { edge: 'ok', tools: 'ok', ci: 'ok', qs: 'ok' }, impact: '27 min outage' },
      { time: 'after', phase: 'lesson', text: 'Move to re2 or the Rust regex engine (linear time); re-introduce the CPU guard; inspect all 3,868 managed rules; profile every rule in the test suite; staged rollouts for WAF rules, with global emergency deploys only for active attacks; an emergency path that runs off the edge.', set: { guard: 'ok', rule: 'ok' }, impact: 'staged rollouts + linear regex' },
    ],
    guard: {
      label: 'Staged rollout',
      branchAfter: 0,
      steps: [
        { time: 'what-if', phase: 'what-if', text: 'With staged rollouts for WAF rules (one of the changes Cloudflare announced), the rule would first reach a small slice of the network instead of everything.', set: { qs: 'change', rule: 'change', edge: 'warn' }, impact: 'one slice affected' },
        { time: 'what-if', phase: 'what-if', text: 'CPU spikes on that slice, the rollout halts and the rule is pulled before the next stage. Functional tests passed, so only a performance canary (or rule profiling in CI) catches this class of bug.', set: { rule: 'off', edge: 'ok', qs: 'ok' }, impact: 'rollout halted at stage 1' },
      ],
    },
  },
  {
    id: 'cloudflare-2025',
    label: 'Cloudflare 2025',
    when: '18 Nov 2025 (UTC)',
    section: '§8',
    shape: 'Automation did what it was told, fast and everywhere',
    nodes: [
      { id: 'ch', label: 'ClickHouse', sub: 'permission change', x: 95, y: 40 },
      { id: 'gen', label: 'Feature-file job', sub: 'every 5 minutes', x: 300, y: 40 },
      { id: 'file', label: 'Bot Mgmt file', sub: '~60 features in use', x: 505, y: 40 },
      { id: 'fl2', label: 'FL2 proxy (Rust)', sub: 'limit: 200 features', x: 505, y: 130 },
      { id: 'traffic', label: 'Customer traffic', x: 300, y: 200 },
      { id: 'status', label: 'Status page', sub: 'hosted off-infra', x: 95, y: 200 },
    ],
    edges: [
      ['ch', 'gen'],
      ['gen', 'file'],
      ['file', 'fl2'],
      ['traffic', 'fl2'],
    ],
    steps: [
      { time: '11:05', phase: 'trigger', text: 'A ClickHouse access-control change makes access to the underlying r0 tables explicit.', set: { ch: 'change' }, impact: 'permission change' },
      { time: '11:05+', phase: 'spread', text: 'A metadata query that listed columns without filtering by database name now returns duplicate rows (from default and r0). The generated feature file roughly doubles and exceeds 200 features.', set: { gen: 'warn', file: 'down' }, impact: 'file doubled, > 200 features' },
      { time: '11:20–11:28', phase: 'detect', text: 'Customer-facing 5xx errors begin: FL2 panics with "called Result::unwrap() on an Err value".', set: { fl2: 'down', traffic: 'down' }, impact: '5xx on core proxy' },
      { time: '11:30+', phase: 'detect', text: 'The failures flap: the cluster is being updated node by node, so each five-minute run produces a good or a bad file. The team first suspects a hyper-scale DDoS, and the status page, hosted off Cloudflare\'s infrastructure, coincidentally goes down too.', set: { file: 'warn', status: 'down' }, impact: 'flapping every 5 min' },
      { time: '13:05', phase: 'mitigate', text: 'Workers KV and Access bypass the core proxy to reduce impact.', set: { traffic: 'warn' }, impact: 'partial bypass' },
      { time: '14:24–14:30', phase: 'mitigate', text: 'Generation and propagation of the file are stopped at 14:24; a known-good file is pushed at 14:30 and the main impact ends.', set: { gen: 'off', file: 'ok', fl2: 'ok', traffic: 'ok', status: 'ok' }, impact: 'known-good file pushed' },
      { time: '17:06', phase: 'recover', text: 'All services restored.', set: { gen: 'ok', ch: 'ok' }, impact: 'fully restored' },
      { time: 'after', phase: 'lesson', text: 'Harden ingestion of Cloudflare-generated config files as if they were user input; more global kill switches. Validate config at the producer and the consumer, keep the last-known-good version on a bad file, and line flapping errors up against periodic job runs.', impact: 'validate + last-known-good' },
    ],
    guard: {
      label: 'Validate + last-known-good',
      branchAfter: 1,
      steps: [
        { time: 'what-if', phase: 'what-if', text: 'With the lesson applied, FL2 validates the new file, sees it exceeds the 200-feature limit and rejects it instead of panicking. It keeps serving with the last-known-good file and raises an alert.', set: { fl2: 'ok', traffic: 'ok' }, impact: 'bad file rejected' },
        { time: 'what-if', phase: 'what-if', text: 'Bot scores may go stale for a while, but traffic keeps flowing; engineers chase the duplicate-rows query without a global outage.', set: { gen: 'warn' }, impact: 'no customer 5xx' },
      ],
    },
  },
  {
    id: 'aws-2025',
    label: 'AWS us-east-1 2025',
    when: '19–20 Oct 2025 (PDT)',
    section: '§9',
    shape: 'Automation did what it was told + recovery is a load event',
    nodes: [
      { id: 'planner', label: 'DNS Planner', sub: 'produces plans', x: 95, y: 40 },
      { id: 'enA', label: 'Enactor A', sub: 'delayed', x: 300, y: 40 },
      { id: 'enB', label: 'Enactor B', sub: 'applies + cleans up', x: 505, y: 40 },
      { id: 'r53', label: 'Route 53 record', sub: 'dynamodb.us-east-1', x: 300, y: 130 },
      { id: 'ec2', label: 'EC2 DWFM', sub: 'host leases', x: 95, y: 200 },
      { id: 'nlb', label: 'NLB health checks', x: 505, y: 200 },
    ],
    edges: [
      ['planner', 'enA'],
      ['planner', 'enB'],
      ['enA', 'r53'],
      ['enB', 'r53'],
      ['r53', 'ec2'],
      ['r53', 'nlb'],
    ],
    steps: [
      { time: 'race', phase: 'trigger', text: 'Enactor A is delayed, retrying updates on several endpoints. The freshness check it made when it started says its plan is newer than what is live.', set: { enA: 'warn' }, impact: 'stale check, still acting' },
      { time: 'race', phase: 'spread', text: 'The Planner keeps producing newer plans. Enactor B applies a much newer plan, then runs cleanup, deleting plans far older than its own, including the one A is still working through.', set: { enB: 'change', r53: 'change' }, impact: 'newer plan live' },
      { time: 'race', phase: 'spread', text: 'A finally applies its stale plan, overwriting B\'s. Its freshness check had gone stale in the meantime (a check-then-act race).', set: { r53: 'warn' }, impact: 'stale plan live' },
      { time: '23:48', phase: 'spread', text: 'B\'s cleanup deletes that old plan. Deleting it removes all IP addresses for dynamodb.us-east-1.amazonaws.com, and the inconsistent state blocks any Enactor from repairing it. DynamoDB errors begin; manual intervention is needed.', set: { r53: 'down', enA: 'off', enB: 'off' }, impact: 'endpoint has no IPs' },
      { time: '00:38–02:40', phase: 'mitigate', text: 'DNS state identified at 00:38, restored at 02:25; cached records expire and DynamoDB errors end at 02:40.', set: { r53: 'ok' }, impact: 'DynamoDB back at 02:40' },
      { time: '02:40–05:28', phase: 'spread', text: 'EC2\'s DropletWorkflow Manager had let host leases time out. With too many leases to re-establish it fell into congestive collapse: work timed out and was retried faster than it completed. Engineers throttled and restarted DWFM hosts at 04:14; leases were restored by 05:28.', set: { ec2: 'down' }, impact: 'congestive collapse in EC2' },
      { time: '05:30–14:09', phase: 'spread', text: 'NLB health checks ran against instances whose network state had not propagated, so they flapped and repeatedly pulled capacity out of DNS. Automatic AZ failover was disabled at 09:36 to stop the churn.', set: { ec2: 'warn', nlb: 'down' }, impact: 'health checks flapping' },
      { time: '13:50–14:09', phase: 'recover', text: 'EC2 launches fully normal at 13:50; the NLB flapping window ends at 14:09.', set: { ec2: 'ok', nlb: 'ok', enA: 'off', enB: 'off' }, impact: 'EC2 + NLB normal' },
      { time: 'after', phase: 'lesson', text: 'The DNS Planner/Enactor automation was disabled worldwide until the race is fixed; NLB velocity control on how much capacity failover can remove; queue-size-based throttling in EC2. Make "apply" a compare-and-set on a generation, never let GC delete what is live, and treat recovery as a load event.', impact: 'CAS on generation + velocity limits' },
    ],
    guard: {
      label: 'Compare-and-set on generation',
      branchAfter: 1,
      steps: [
        { time: 'what-if', phase: 'what-if', text: 'If "apply" were a conditional write ("only if live.generation < mine"), A\'s attempt to apply its older plan over B\'s newer one would be rejected at write time, however stale its earlier check was.', set: { enA: 'off', r53: 'ok' }, impact: 'stale apply rejected' },
        { time: 'what-if', phase: 'what-if', text: 'And a cleanup that never deletes the plan that is currently live cannot empty the record. The endpoint keeps its IPs, so nothing downstream has leases to rebuild.', set: { enB: 'ok' }, impact: 'endpoint stays populated' },
      ],
    },
  },
  {
    id: 'meta-2021',
    label: 'Meta 2021',
    when: '4 Oct 2021 (UTC)',
    section: '§10',
    shape: 'Self-protection that turns into a total outage',
    nodes: [
      { id: 'cmd', label: 'Maintenance command', sub: 'assess capacity', x: 95, y: 40 },
      { id: 'audit', label: 'Audit tool', sub: 'should block it', x: 300, y: 40 },
      { id: 'backbone', label: 'Backbone', sub: 'links between DCs', x: 505, y: 40 },
      { id: 'dns', label: 'Edge DNS servers', sub: 'anycast via BGP', x: 505, y: 130 },
      { id: 'resolvers', label: 'Resolvers worldwide', x: 300, y: 200 },
      { id: 'access', label: 'Remote access + tools', x: 95, y: 200 },
    ],
    edges: [
      ['cmd', 'audit'],
      ['audit', 'backbone'],
      ['backbone', 'dns'],
      ['dns', 'resolvers'],
      ['access', 'backbone'],
    ],
    steps: [
      { time: 'maintenance', phase: 'trigger', text: 'During routine maintenance, a command meant to assess global backbone capacity is run. An audit tool that should have blocked it has a bug and lets it through.', set: { cmd: 'change', audit: 'warn' }, impact: 'unsafe command allowed' },
      { time: 'next', phase: 'spread', text: 'The command unintentionally takes down all backbone connections.', set: { backbone: 'down' }, impact: 'all backbone links down' },
      { time: '~15:40', phase: 'spread', text: 'Routing trouble is visible from about 15:40 UTC (Cloudflare\'s data). The edge DNS servers, designed to withdraw their BGP announcements when they cannot reach the data centres, declare themselves unhealthy and withdraw. They are still operational but unreachable, so facebook.com, Instagram and WhatsApp stop resolving worldwide.', set: { dns: 'down', resolvers: 'down' }, impact: 'names stop resolving' },
      { time: 'during', phase: 'spread', text: 'Resolvers worldwide see 30× normal query volume as clients retry. Internal tools and remote access share the same infrastructure, so engineers have to go on site, and data-centre security slows physical access by design.', set: { access: 'down' }, impact: '30× DNS query volume' },
      { time: 'recovery', phase: 'mitigate', text: 'Turning everything back on at once could overload electrical systems (data centres had shown power dips of tens of megawatts) and cold caches, so traffic returns in stages. Meta credited its "storm" drills, though it had never drilled a global backbone outage.', set: { backbone: 'warn', access: 'warn' }, impact: 'staged restore' },
      { time: '~21:28', phase: 'recover', text: 'DNS works again. Meta\'s post gives no duration; from Cloudflare\'s measurements it is roughly 5.5 hours (facebook.com unresolvable on 1.1.1.1 from ~15:50 to 21:20 UTC).', set: { backbone: 'ok', dns: 'ok', resolvers: 'ok', access: 'ok', cmd: 'ok', audit: 'ok' }, impact: '~5.5 h (per Cloudflare)' },
      { time: 'after', phase: 'lesson', text: 'Out-of-band access for the infrastructure you need to fix the infrastructure; self-protective health logic needs a global sanity check; change tooling is part of production; restore gradually; clients should back off failed DNS lookups.', impact: 'global floor + out-of-band access' },
    ],
    guard: {
      label: 'Global floor on withdrawal',
      branchAfter: 1,
      steps: [
        { time: 'what-if', phase: 'what-if', text: 'With a global sanity check ("if everyone looks unhealthy, the detector is probably wrong"), the DNS servers would refuse to withdraw every site at once and keep announcing their routes.', set: { dns: 'warn' }, impact: 'routes kept' },
        { time: 'what-if', phase: 'what-if', text: 'The backbone is still down, so services behind it are impaired, but the names keep resolving and the outage stays a backbone incident instead of the whole company vanishing from the internet. Out-of-band access would still be needed to fix the backbone.', set: { resolvers: 'warn' }, impact: 'still a backbone incident' },
      ],
    },
  },
];
