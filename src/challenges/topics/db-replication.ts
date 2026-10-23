import type { ChallengeSet, Expr } from '../types';

const sb: Expr = { knob: 'sb' };
const lvl: Expr = { knob: 'lvl' };
const reads: Expr = { knob: 'reads' };

const set: ChallengeSet = {
  topic: 'db-replication',
  puzzles: [
    {
      mode: 'match',
      id: 'replica-lag-causes',
      tab: 'Lag on call',
      title: 'Five lag alerts: match each one to its fix',
      brief:
        'The orders cluster pages you five times in one week, each time about replication. Patch every alert to the fix that removes its cause, not the one that just hides the graph.',
      leftTitle: 'Alert',
      rightTitle: 'Fix',
      instruction: 'Connect each alert to the fix for its cause',
      left: [
        {
          id: 'bigtx',
          label: 'Byte lag jumps the moment a 40M-row UPDATE commits',
          answer: 'chunk',
          because:
            'A huge single transaction or bulk job floods the WAL at once. Batches of a few thousand rows with pauses (throttled on replica lag) keep replay caught up.',
        },
        {
          id: 'cancel',
          label: 'Replica reports die: "conflict with recovery"',
          answer: 'analytics',
          because:
            'Long replica queries conflict with replay (vacuum cleanup of rows they need). A dedicated analytics replica with a larger max_standby_streaming_delay keeps them away from OLTP replicas.',
        },
        {
          id: 'onecore',
          label: 'Replica: one core at 100%, the rest idle, lag growing',
          answer: 'wal',
          because:
            'Postgres replays WAL in a single startup process. Producing less WAL (fewer indexes, wal_compression, longer checkpoints to avoid full-page-write storms) is what helps.',
        },
        {
          id: 'disk',
          label: 'Primary disk filling, yet every replica is caught up',
          answer: 'slot',
          because:
            'An inactive replication slot (an old CDC consumer) makes the primary retain WAL forever. Cap it with max_slot_wal_keep_size and alert on active = false.',
        },
        {
          id: 'idle',
          label: 'At 3 a.m. replay delay climbs for 10 min with zero writes',
          answer: 'bytes',
          because:
            'now() − pg_last_xact_replay_timestamp() grows whenever the primary is idle, even when replicas are fully caught up. Byte lag from pg_stat_replication is zero in that case.',
        },
      ],
      right: [
        { id: 'chunk', label: 'Small batches, throttled on lag', sub: '2,000 rows, pause', is: 'splitting bulk writes into short transactions that wait while replica lag is high' },
        { id: 'analytics', label: 'Dedicated analytics replica', sub: 'larger standby delay', is: 'a separate replica for long queries, tuned to tolerate replay pauses so OLTP replicas stay fresh' },
        { id: 'wal', label: 'Generate less WAL', sub: 'fewer indexes, compression', is: 'cutting the volume the single-threaded replay process has to apply' },
        { id: 'slot', label: 'Cap retained WAL, alert on slots', sub: 'max_slot_wal_keep_size', is: 'a limit on how much WAL an abandoned slot can pin, plus an alert on inactive slots' },
        { id: 'bytes', label: 'Measure lag in WAL bytes', sub: 'pg_wal_lsn_diff', is: 'measuring un-replayed WAL on the primary, which is zero when replicas are caught up' },
        {
          id: 'more',
          label: 'Add two more read replicas',
          sub: 'spread the load',
          decoy: true,
          is: 'more read capacity, but every replica still replays 100% of the writes, so none of these causes goes away',
        },
        {
          id: 'vertical',
          label: 'Primary on 2× the cores',
          sub: 'vertical scale',
          decoy: true,
          is: 'more write capacity on the primary, which does nothing for how fast replicas replay, which queries they cancel or what an abandoned slot retains',
        },
      ],
      why: [
        'Lag has causes you can name: write bursts, huge transactions, replica queries conflicting with replay, single-threaded replay, network and under-provisioned replicas.',
        'Fix the source: chunk and throttle bulk writes, isolate analytics, and reduce WAL volume.',
        'Measure lag in bytes as well as time: the replay timestamp lies while the primary is idle.',
        'Inactive slots retain WAL until the disk fills, so cap them and alert on them.',
      ],
    },
    {
      mode: 'sequence',
      id: 'pg-failover-runbook',
      tab: 'Failover runbook',
      title: 'Patroni failover: the primary\'s host just died',
      brief:
        'The orders primary stopped renewing its leader key in etcd. Put the failover steps in order so the cluster loses as little as possible and never ends up with two primaries.',
      layout: 'stages',
      steps: [
        {
          id: 'detect',
          label: 'Detect: lease not renewed',
          sub: 'leader key TTL 30 s',
          clue: 'Decide it is really gone',
          is: 'detection through a consensus-backed leader lease; timeouts trade false positives against detection speed',
        },
        {
          id: 'choose',
          label: 'Choose most advanced LSN',
          sub: 'or the sync standby',
          clue: 'Whoever lost the least',
          is: 'picking the replica with the most advanced LSN (or the synchronous standby, for RPO 0)',
        },
        {
          id: 'promote',
          label: 'Promote: pg_promote()',
          sub: 'new timeline',
          clue: 'Replica leaves recovery',
          is: 'the replica exiting recovery and starting a new timeline as the primary',
        },
        {
          id: 'fence',
          label: 'Fence the old primary',
          sub: 'STONITH, no lease',
          clue: 'The old one must not write',
          is: 'making sure the old primary cannot accept writes: power it off, revoke its IP, or let it demote itself without the lease',
        },
        {
          id: 'repoint',
          label: 'Repoint clients',
          sub: 'DNS / VIP / proxy',
          clue: 'Traffic finds the new primary',
          is: 'switching DNS, the VIP or the proxy and re-establishing pools; other replicas follow the new primary',
        },
        {
          id: 'rewind',
          label: 'pg_rewind, rejoin',
          sub: 'old primary → replica',
          clue: 'Bring the old node back safely',
          is: 'rewinding the diverged old primary so it can rejoin as a replica, discarding its unreplicated transactions',
        },
      ],
      decoys: [
        {
          id: 'least',
          label: 'Promote least-loaded replica',
          sub: 'lowest CPU',
          is: 'choosing by load instead of LSN, which can promote a replica that is far behind and lose more data',
        },
        {
          id: 'blip',
          label: 'Fail over on one missed ping',
          sub: 'aggressive detection',
          is: 'a recipe for flapping: a network blip triggers needless failovers; use hysteresis',
        },
        {
          id: 'both',
          label: 'Keep old primary writable',
          sub: 'until DNS TTL expires',
          is: 'split brain: two primaries accept diverging writes, which is exactly what fencing prevents',
        },
      ],
      why: [
        'Failover = detect → choose the most up-to-date replica → promote → fence → repoint.',
        'With async replication the gap is lost, along with any emails or events that already acted on it.',
        'Split brain is prevented by fencing plus a consensus-backed leader lease: no lease, no writes.',
        'pg_rewind lets the old primary rejoin as a replica after its timeline diverged.',
      ],
    },
    {
      mode: 'route',
      id: 'wallet-read-routing',
      tab: 'Route the queries',
      title: 'Wallet: send every query to the right copy',
      brief:
        'A wallet API runs on one primary and two async replicas, and Replica B is 8 s behind while a backfill runs. Steer each query so nobody sees a stale balance or overdraws, and the primary stays free for writes.',
      cols: 4,
      rows: 3.3,
      nodes: [
        { id: 'api', label: 'Wallet API', sub: 'NestJS', kind: 'terminal', col: 0, row: 0.9 },
        { id: 'router', label: 'Read router', sub: 'compares replay LSNs', col: 1.5, row: 1.95 },
        { id: 'primary', label: 'Primary', sub: 'all writes · WAL', col: 3, row: 0.05 },
        { id: 'ra', label: 'Replica A', sub: 'replayed to 3/A1C0', col: 3, row: 1.2 },
        { id: 'rb', label: 'Replica B', sub: '8 s behind · 3/9F00', col: 3, row: 2.35 },
      ],
      edges: [
        ['api', 'primary', 'writer'],
        ['api', 'router', 'reader'],
        ['router', 'primary', 'fallback'],
        ['router', 'ra'],
        ['router', 'rb'],
      ],
      packets: [
        {
          id: 'topup',
          label: 'Top-up ₹500: UPDATE … RETURNING',
          sub: 'a write',
          from: 'api',
          paths: [['api', 'primary']],
          wrong: {
            'api>router':
              'The reader pool is for SELECTs outside a transaction. Replicas are read-only copies that replay the primary’s WAL, so a write has to go to the writer: the primary.',
          },
          done: 'All writes go to the one primary. It returns the new balance with RETURNING and hands back the commit LSN (3/A1B2) as a causal token for the reads that follow.',
        },
        {
          id: 'read-after',
          label: 'Balance shown right after the top-up',
          sub: 'carries token LSN 3/A1B2',
          from: 'api',
          paths: [['api', 'router', 'ra']],
          wrong: {
            'api>primary':
              'Reading your own data from the primary is correct, but this service carries a causal token precisely so display reads can stay on replicas. Let the router find a replica that has replayed it.',
            'router>rb':
              'Replica B has only replayed up to 3/9F00, which is behind the token 3/A1B2. It would show the balance from before the top-up: the classic “my money vanished” bug.',
            'router>primary':
              'The primary is the fallback for when no replica has replayed the token yet. Replica A already has (3/A1C0 ≥ 3/A1B2), so the read can stay off the primary.',
          },
          done: 'Replica A’s pg_last_wal_replay_lsn() is at or past the token, so it already contains the top-up. You get read-your-writes without loading the primary.',
        },
        {
          id: 'withdraw',
          label: 'Withdraw ₹300: check funds, then debit',
          sub: 'balance ≥ 300 ? debit',
          from: 'api',
          paths: [['api', 'primary']],
          wrong: {
            'api>router':
              'This funds check is a read that feeds a write. Checking on a replica 8 s behind is exactly how two withdrawals overdrew accounts. The check and the debit must be one conditional UPDATE … WHERE balance >= $1 on the primary.',
          },
          done: 'A single UPDATE … SET balance = balance − $1 WHERE balance >= $1 on the primary checks and debits atomically. The row lock serialises concurrent withdrawals, so no stale read is possible.',
        },
        {
          id: 'history',
          label: 'Transaction history page',
          sub: 'no recent write · no token',
          from: 'api',
          paths: [['api', 'router', 'ra']],
          wrong: {
            'api>primary':
              'History can tolerate a little staleness, so it belongs on a replica. Sending it to the primary spends the capacity that the replicas exist to offload.',
            'router>rb':
              'Lag-aware routing ejects a replica whose lag is over the threshold (for example 5 s). Replica B is 8 s behind and would show a history that is missing recent payments.',
            'router>primary':
              'The fallback is for reads that no healthy replica can serve. Replica A can serve this one, and a router that floods the primary with fallbacks is how a lag-aware router takes the primary down.',
          },
          done: 'Stale-tolerant reads go to a healthy replica. The router health-checks replicas on replay lag and skips any that are over the threshold, so the primary is protected.',
        },
      ],
      why: [
        'Writes, transactions and reads that feed a write go to the primary. Replicas are read-only and always somewhat behind.',
        'Read-your-writes with a causal token: a write returns its commit LSN, and a read may use any replica whose replay LSN has reached it.',
        'Lag-aware routing ejects replicas that are over a lag threshold. Fall back to the primary only for critical reads, and guard it against fallback floods.',
        'Replicas add read capacity and availability, not write capacity, and every replica still applies 100% of the writes.',
      ],
    },
    {
      mode: 'tune',
      id: 'wallet-sync-commit',
      tab: 'Durable, fast commits',
      title: 'Wallet DB: durable payments without slow commits',
      brief:
        'A wallet\'s Postgres primary sits in AZ-a (local WAL flush ~1 ms). Standbys in AZ-b and AZ-c are ~1 ms away, the DR replica ~200 ms away, and async replicas run ~300 ms behind at peak. Users read their balance right after paying.',
      cols: 4,
      rows: 3.2,
      nodes: [
        { id: 'app', label: 'Wallet API', sub: 'pay, then show balance', kind: 'terminal', col: 0, row: 1.1 },
        { id: 'pri', label: 'Primary · AZ-a', sub: 'commits wait here', col: 1.5, row: 1.1 },
        { id: 'b', label: 'Standby · AZ-b', sub: '~1 ms', col: 3, row: 0 },
        { id: 'c', label: 'Standby · AZ-c', sub: '~1 ms', col: 3, row: 1.1 },
        { id: 'dr', label: 'DR replica', sub: 'other region · ~200 ms', col: 3, row: 2.2 },
      ],
      edges: [
        ['app', 'pri', 'COMMIT'],
        ['pri', 'b', 'WAL'],
        ['pri', 'c', 'WAL'],
        ['pri', 'dr', 'WAL'],
      ],
      knobs: [
        {
          id: 'sb',
          label: 'Sync standbys',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 1, label: 'none (all async)' },
            { value: 2, label: 'FIRST 1 (az_b)' },
            { value: 3, label: 'ANY 1 (az_b, az_c)' },
            { value: 4, label: 'FIRST 1 (dr)' },
          ],
          help: 'synchronous_standby_names: who a commit waits for',
        },
        {
          id: 'lvl',
          label: 'Payment commit level',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 1, label: 'local' },
            { value: 2, label: 'remote_write' },
            { value: 3, label: 'on' },
            { value: 4, label: 'remote_apply' },
          ],
          help: 'synchronous_commit for payment transactions',
        },
        {
          id: 'reads',
          label: 'Balance read routing',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 1, label: 'Any replica' },
            { value: 2, label: 'Primary for 5 s' },
            { value: 3, label: 'LSN causal token' },
          ],
          help: 'where the next read goes',
        },
      ],
      constraints: [
        {
          id: 'rpo',
          label: 'Acked payments lost on failover',
          left: {
            op: 'if',
            cond: { all: [{ left: sb, op: '>=', right: 2 }, { left: lvl, op: '>=', right: 3 }] },
            then: 0,
            else: 300,
          },
          op: '<=',
          right: 0,
          unit: ' ms',
          hint: 'An acknowledged commit is safe only if a standby has flushed it to disk before the client hears "committed".',
          fail: 'Commits are acknowledged before any standby has flushed them, so a failover loses up to the replication lag (~300 ms of payments).',
          pass: 'Every acknowledged payment is flushed on a synchronous standby first: RPO 0 for acked commits.',
        },
        {
          id: 'latency',
          label: 'Payment commit ≤ 5 ms',
          left: {
            op: 'add',
            args: [1, { op: 'if', cond: { left: lvl, op: '>=', right: 2 }, then: { op: 'pick', list: [0, 1, 1, 200], index: sb }, else: 0 }],
          },
          op: '<=',
          right: 5,
          unit: ' ms',
          hint: 'A synchronous commit adds the round trip to the standby it waits for. Where is that standby?',
          fail: 'Each commit waits for a standby ~200 ms away: sync replication across regions adds at least 200 ms to every commit.',
          pass: 'The commit waits only for a same-region standby, about 1 ms away.',
        },
        {
          id: 'avail',
          label: 'Standby losses tolerated',
          left: {
            op: 'if',
            cond: { any: [{ left: sb, op: '==', right: 1 }, { left: lvl, op: '==', right: 1 }] },
            then: 2,
            else: { op: 'pick', list: [2, 0, 1, 0], index: sb },
          },
          op: '>=',
          right: 1,
          unit: ' standby',
          hint: 'If the one standby you wait for dies, can writes still commit?',
          fail: 'Commits wait on one named standby: if it dies, every write blocks.',
          pass: 'ANY 1 of two standbys: losing one replica does not block writes.',
        },
        {
          id: 'ryw',
          label: 'Stale own-balance window',
          left: { op: 'if', cond: { left: reads, op: '==', right: 1 }, then: 300, else: 0 },
          op: '<=',
          right: 0,
          unit: ' ms',
          hint: 'The refresh after paying may land on a replica that has not replayed the payment yet.',
          fail: 'The next read can hit a replica ~300 ms behind, and the user sees their old balance: the payment "didn\'t work".',
          pass: 'The read goes to the primary right after a write, or to a replica whose replay LSN has reached the commit: read-your-writes holds.',
        },
      ],
      why: [
        'Sync to a standby in another AZ of the same region (~1 ms) and async to the DR region: RPO 0 without 200 ms commits.',
        'ANY 1 (az_b, az_c) is quorum commit: one dead standby does not block writes, unlike FIRST 1 with a single name.',
        'synchronous_commit = on waits for a remote flush; it can be set per transaction, so clickstream can use off.',
        'Read-your-writes needs routing: primary for N seconds after a write, or an LSN causal token (precise, less primary load).',
      ],
    },
    {
      mode: 'spike',
      id: 'replica-fallback-flood',
      tab: 'Backfill + read surge',
      title: 'A backfill meets the morning read surge',
      brief:
        'A catalog API sends reads to 2 async replicas through a lag-aware router (eject at 5 s lag, fall back to the primary). At second 6 an unthrottled backfill starts, and reads then triple. Scenario sizing: the primary takes ~20K queries/s (5K are writes), each replica ~20K reads/s. You can make two changes.',
      cols: 4,
      rows: 2.1,
      nodes: [
        { id: 'users', label: 'Catalog API', sub: 'reads/s', kind: 'terminal', col: 0, row: 0.55 },
        { id: 'router', label: 'Read router', sub: 'eject at 5 s lag', col: 1.35, row: 0.55, share: 1, ms: 3 },
        { id: 'primary', label: 'Primary', sub: 'writes 5K/s + fallback', col: 2.95, row: 0, capacity: 20000, unit: 'q/s', base: 5000, ms: 2, timeoutMs: 1000 },
        { id: 'replicas', label: 'Replicas × 2', sub: 'async · ~20K reads/s each', col: 2.95, row: 1.1, share: 1, capacity: 40000, unit: 'reads/s', ms: 2, timeoutMs: 1000 },
      ],
      edges: [
        ['users', 'router'],
        ['router', 'replicas', 'reads'],
        ['router', 'primary', 'fallback'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 30000],
        [24, 30000],
        [50, 90000],
        [60, 90000],
      ],
      bursts: [{ node: 'primary', from: 6, to: 16, add: 36000, label: 'replicas ejected' }],
      maxCards: 2,
      cards: [
        {
          id: 'throttle',
          label: 'Throttle backfill on lag',
          sub: '2,000-row batches, wait',
          node: 'primary',
          effects: [{ node: 'primary', load: 0.05 }],
          is: 'backpressure from the replicas: the job writes small batches and waits while un-replayed WAL is over 64 MB, so lag never reaches the 5 s ejection threshold and reads stay on the replicas',
        },
        {
          id: 'add-replicas',
          label: 'Add 3 read replicas',
          sub: '2 → 5 replicas',
          node: 'replicas',
          effects: [{ node: 'replicas', capacity: 2.5 }],
          is: 'more read capacity: each replica serves a similar read load, so 5 replicas take ~100K reads/s (each still replays every write)',
        },
        {
          id: 'bigger-primary',
          label: 'Primary on 2× the cores',
          sub: 'vertical scale',
          node: 'primary',
          decoy: true,
          effects: [{ node: 'primary', capacity: 2 }],
          is: 'a bigger writer for a read problem: with every replica ejected, ~36K fallback reads/s plus 5K writes still overflow a box twice the size, and it adds no replica capacity later',
        },
        {
          id: 'sticky',
          label: 'Pin each user to one replica',
          sub: 'hash user id → replica',
          node: 'router',
          decoy: true,
          effects: [],
          is: 'a consistency fix (monotonic reads), not capacity: the same reads land on the same replicas, and ejected replicas still push everyone to the primary',
        },
      ],
      goals: [
        { metric: 'p99', max: 200, label: 'p99 ≤ 200 ms', fail: 'A saturated box is making the slowest reads wait for the 1 s timeout.' },
        { metric: 'errors', max: 1, label: 'Errors ≤ 1%', fail: 'A database is past its capacity and the excess queries fail.' },
      ],
      why: [
        'An unthrottled bulk job is a classic lag cause. When lag crosses the ejection threshold, a lag-aware router moves every read onto the primary.',
        'Throttling the backfill on replica lag (small batches, wait while lag is high) prevents the ejection, so the fallback flood never happens.',
        'Replicas scale reads: with a 90/10 read/write mix, more replicas take several times the read load of the primary alone.',
        'A bigger primary does not fix a read problem, and pinning users to replicas buys monotonic reads, not capacity.',
      ],
    },
  ],
};

export default set;
