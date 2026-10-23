import type { ChallengeSet, Expr } from '../types';

const W: Expr = { knob: 'W' };
const L: Expr = { knob: 'L' };
/** busy threads at peak: every Node process runs its main thread plus ~1 busy V8 GC/JIT thread (scenario) */
const T: Expr = { op: 'mul', args: [W, 2] };
/** ms of each 100 ms CFS period the cgroup spends frozen: quota L×100 ms is burned in 100·L/T ms of wall time */
const frozen: Expr = { op: 'max', args: [0, { op: 'sub', args: [100, { op: 'div', args: [{ op: 'mul', args: [100, L] }, T] }] }] };

const set: ChallengeSet = {
  topic: 'fund-os-kernel',
  puzzles: [
    {
      mode: 'sequence',
      id: 'os-commit-durability',
      tab: 'Commit to NAND',
      title: 'One commit, from write() to NAND',
      brief:
        'A payments service must never lose an acknowledged transfer, even on a power cut. Order what Postgres and the kernel do between COMMIT and the bytes being safe, including when the client may be told "OK".',
      layout: 'stages',
      steps: [
        {
          id: 'wal-rec',
          label: 'Append commit record to WAL',
          sub: 'WAL buffers in memory',
          clue: 'The log comes before the data',
          is: 'the write-ahead rule: the record describing the change goes into the WAL before any data page is written',
        },
        {
          id: 'pagecache',
          label: 'write() into the page cache',
          sub: 'dirty pages, returns in µs',
          clue: 'Survives a process crash only',
          is: 'copying the WAL bytes into kernel memory; it returns in microseconds, but a kernel crash or power loss still loses them',
        },
        {
          id: 'fsync',
          label: 'fdatasync the WAL segment',
          sub: 'group commit',
          clue: 'One flush covers many commits',
          is: 'forcing the WAL to the device; one call acknowledges every commit record up to the flushed LSN (group commit)',
        },
        {
          id: 'flush',
          label: 'Drive flushes its cache',
          sub: 'FLUSH / FUA, or PLP',
          clue: 'The drive must not lie',
          is: 'the SSD moving data from its volatile DRAM cache to NAND (or having power-loss protection); a drive that acks flushes it skipped breaks durability',
        },
        {
          id: 'ack',
          label: 'Reply OK to the client',
          sub: 'commit is durable',
          clue: 'Only now is it safe to say OK',
          is: 'the commit acknowledgement, sent once the commit record is durable so a crash afterwards can always be redone from the WAL',
        },
        {
          id: 'checkpoint',
          label: 'Checkpoint writes data pages',
          sub: 'every 5 min or 1 GB WAL',
          clue: 'The data files are tidied later',
          is: 'the background flush of dirty buffers to the data files, which lets old WAL be recycled and bounds crash-recovery time',
        },
      ],
      decoys: [
        {
          id: 'page-first',
          label: 'Write the data page first',
          sub: 'then log the change',
          is: 'the reverse of write-ahead logging: a crash between the two leaves a changed page with no log record to redo or repair it',
        },
        {
          id: 'retry-eio',
          label: 'Retry fsync after EIO',
          sub: 'and trust the success',
          is: 'the fsyncgate trap: the kernel may have dropped the dirty pages, so a retried fsync can succeed with the data gone; Postgres PANICs and replays the WAL instead',
        },
        {
          id: 'odirect',
          label: 'O_DIRECT, so skip fsync',
          sub: 'bypass the page cache',
          is: 'a bypass of the page cache, not the device cache: data can still sit in volatile drive DRAM, so fsync or O_DSYNC is still needed',
        },
      ],
      why: [
        'write() returning means "copied to the kernel": it survives a process crash, not a power cut.',
        'A commit is durable once its WAL record is fsynced and the device honours the flush; only then is OK sent.',
        'Group commit lets one fsync acknowledge many commits, so throughput scales with concurrency.',
        'An fsync error may mean the pages are gone: crash and replay the WAL, never retry and trust.',
      ],
    },
    {
      mode: 'match',
      id: 'os-kernel-triage',
      tab: 'Kernel triage',
      title: 'Kernel triage: match each page to its cause',
      brief:
        'Six alerts in one week on a Node and Redis platform, and the dashboards say "CPU looks fine". Patch each symptom to the kernel mechanism behind it. Two causes on the right are popular guesses that explain none of them.',
      leftTitle: 'Symptom',
      rightTitle: 'Kernel cause',
      left: [
        {
          id: 'cliffs',
          label: 'p99 cliffs of ~75 ms while average CPU sits at 40%',
          answer: 'cfs',
          because:
            'limits.cpu: 2 is 200 ms of CPU per 100 ms period summed over every thread (V8 GC, JIT, libuv pool). Eight busy threads burn it in 25 ms and the cgroup is frozen for 75 ms. Check nr_throttled in cpu.stat.',
        },
        {
          id: 'exit137',
          label: 'Pod killed with exit 137; heap was only 600 MB of 1 GB',
          answer: 'oom',
          because:
            'Exit 137 is SIGKILL from the OOM killer. The limit counts RSS: off-heap Buffers, thread stacks, arenas and dirty page cache, not just heapUsed.',
        },
        {
          id: 'bgsave',
          label: 'Redis memory nearly doubles during every BGSAVE',
          answer: 'cow',
          because:
            'fork() shares pages until the parent writes. With Transparent Huge Pages each touched page copies 2 MB instead of 4 KB, so a few writes duplicate most of the heap. Disable THP on Redis hosts.',
        },
        {
          id: 'emfile',
          label: 'accept() fails with EMFILE; CLOSE_WAIT sockets pile up',
          answer: 'fdleak',
          because:
            'CLOSE_WAIT means the peer closed but our code never called close(); each one holds an fd until the per-process limit (often a soft 1024) is reached.',
        },
        {
          id: 'readfile',
          label: 'fs.readFile takes seconds whenever the DNS resolver is slow',
          answer: 'uvpool',
          because:
            'dns.lookup wraps blocking getaddrinfo on the 4-thread libuv pool, a shared FIFO: four slow lookups queue every fs call behind them.',
        },
        {
          id: 'recvq',
          label: 'Server sockets show Recv-Q growing; the network is clean',
          answer: 'blocked',
          because:
            'On an ESTABLISHED socket, Recv-Q is bytes the kernel received that the process has not read yet: the app is slow (blocked loop, CPU starved), not the network.',
        },
      ],
      right: [
        { id: 'cfs', label: 'CFS quota throttling', sub: 'cgroup cpu.max', is: 'the container being frozen for the rest of a 100 ms period once all its threads used the quota' },
        { id: 'oom', label: 'OOM killer counting all of RSS', sub: 'SIGKILL', is: 'the kernel killing the process whose resident memory crossed the cgroup limit' },
        { id: 'cow', label: 'Copy-on-write with THP on', sub: 'fork + 2 MB pages', is: 'pages written by the parent during a fork being duplicated, 2 MB at a time with huge pages' },
        { id: 'fdleak', label: 'File-descriptor leak', sub: 'RLIMIT_NOFILE', is: 'sockets or files that are opened but never closed until the process runs out of descriptors' },
        { id: 'uvpool', label: 'libuv pool saturated by DNS', sub: '4 threads, shared FIFO', is: 'slow getaddrinfo calls occupying the few pool threads that fs, crypto and zlib also need' },
        { id: 'blocked', label: 'Event loop blocked by sync work', sub: 'loop delay high', is: 'one thread busy with synchronous CPU work, so it stops reading sockets the kernel has already filled' },
        {
          id: 'ctxswitch',
          label: 'Too many context switches',
          sub: '~1–5 µs each',
          decoy: true,
          is: 'a real but microsecond-scale cost; it cannot explain 75 ms cliffs, SIGKILLs or doubled memory',
        },
        {
          id: 'packetloss',
          label: 'Packet loss on the network',
          sub: 'retransmits',
          decoy: true,
          is: 'a network problem that shows up as Send-Q and retransmits; none of these symptoms points at the wire',
        },
      ],
      why: [
        'Container CPU limits are a quota for every thread in the cgroup: throttling shows as periodic p99 cliffs with modest average CPU.',
        'Size memory limits on RSS, not on heapUsed; exit 137 is the OOM killer, with no stack trace.',
        'fork is cheap in time but costs memory later through copy-on-write; THP makes every copy 2 MB.',
        'Everything is an fd, and Node\'s 4-thread pool is shared: CLOSE_WAIT means our leak, slow DNS stalls file I/O.',
      ],
    },
    {
      mode: 'route',
      id: 'os-node-where-it-runs',
      tab: 'Where does it run?',
      title: 'Node: send each call to the thread that runs it',
      brief:
        'A Node checkout service makes four kinds of calls on a busy pod. Steer each one to where libuv actually runs it: the event loop’s epoll, the 4-thread pool, or inline on the main thread. Getting this wrong is how a slow resolver ends up delaying file reads.',
      cols: 4.2,
      rows: 3,
      nodes: [
        { id: 'js', label: 'Your handler', sub: 'JS on the main thread', kind: 'terminal', col: 0, row: 1 },
        { id: 'inline', label: 'Main thread, inline', sub: 'blocks the whole loop', col: 1, row: 0 },
        { id: 'epoll', label: 'Event loop: epoll', sub: 'readiness, no threads', col: 1, row: 1 },
        { id: 'pool', label: 'libuv thread pool', sub: '4 threads · shared FIFO', col: 1, row: 2 },
        { id: 'udp', label: 'DNS server over UDP', sub: 'async socket', col: 2.1, row: 0.4 },
        { id: 'disk', label: 'Disk file read', sub: 'may block on I/O', col: 2.1, row: 1.4 },
        { id: 'gai', label: 'getaddr\u200Binfo(3)', sub: '/etc/hosts · nsswitch', col: 3.2, row: 2 },
      ],
      edges: [
        ['js', 'inline'],
        ['js', 'epoll'],
        ['js', 'pool'],
        ['epoll', 'udp'],
        ['pool', 'disk'],
        ['pool', 'gai'],
      ],
      packets: [
        {
          id: 'hash-sync',
          label: 'Login: crypto.pbkdf2Sync(password, …)',
          sub: '~100 ms of CPU',
          from: 'js',
          paths: [['js', 'inline']],
          wrong: {
            'js>pool':
              'Only the async crypto.pbkdf2 goes to the pool. The *Sync variant runs inline on the calling thread, so for ~100 ms the loop serves nobody.',
            'js>epoll':
              'epoll only tracks readiness of sockets, pipes and signals. Hashing is pure CPU work with nothing to wait for, and the Sync call runs right where it was called.',
          },
          done: 'Every *Sync API runs inline on the main thread and blocks every other request. Use the async version (pool) or worker_threads for CPU work at scale.',
        },
        {
          id: 'read-config',
          label: 'fs.promises.readFile("/app/prices.json")',
          sub: 'async file read',
          from: 'js',
          paths: [['js', 'pool', 'disk']],
          wrong: {
            'js>epoll':
              'Regular files are always “ready” to epoll, so readiness says nothing and the read can still block on disk. libuv sends file I/O to the thread pool instead.',
            'js>inline':
              'The promise API is asynchronous: the main thread only queues the request. Only readFileSync would run inline and block the loop.',
            'pool>gai': 'This job is a file read, not a name lookup: the pool thread calls read() on the file.',
          },
          done: 'Async fs runs on one of the 4 pool threads, sharing a FIFO with dns.lookup, async crypto and zlib.',
        },
        {
          id: 'lookup',
          label: 'http.get("api.partner.com"): host lookup',
          sub: 'default resolver: dns.lookup',
          from: 'js',
          paths: [['js', 'pool', 'gai']],
          wrong: {
            'js>epoll':
              'dns.lookup wraps the blocking getaddrinfo(3) so it can honour /etc/hosts and nsswitch. A blocking libc call can’t be driven by epoll, so it takes a pool thread.',
            'js>inline':
              'The lookup is asynchronous from JavaScript’s point of view; it doesn’t freeze the loop. It does wait for a free pool thread, though.',
            'pool>disk': 'The pool thread runs getaddrinfo(3), not a file read, even though it may consult /etc/hosts along the way.',
          },
          done: 'dns.lookup holds a pool thread for the whole getaddrinfo call: four slow lookups (5 s resolver timeout) stall every fs.readFile queued behind them.',
        },
        {
          id: 'resolve',
          label: 'dns.resolve4("api.partner.com")',
          sub: 'c-ares resolver',
          from: 'js',
          paths: [['js', 'epoll', 'udp']],
          wrong: {
            'js>pool':
              'dns.resolve* uses c-ares, which talks to the DNS server directly with async UDP sockets. It never takes a pool thread (and it ignores /etc/hosts).',
            'js>inline': 'c-ares is asynchronous: it sends the query and lets epoll report the reply, so nothing blocks the main thread.',
          },
          done: 'c-ares runs on the main thread through epoll, so hot outbound paths that use it (or a DNS cache) can’t clog the shared pool.',
        },
      ],
      why: [
        'Sockets support readiness: TCP, UDP, pipes and signals are epoll-driven on the main thread with no extra threads.',
        'Files, dns.lookup (getaddrinfo), async crypto and zlib share the 4-thread libuv pool, a single FIFO.',
        'dns.resolve* uses c-ares over async UDP on the loop and skips /etc/hosts.',
        'Any *Sync call or heavy CPU work runs inline and blocks every request on that process.',
      ],
    },
    {
      mode: 'fault',
      id: 'os-export-vm',
      tab: 'Export VM incident',
      title: 'The export box: hot workers, OOMs and EMFILE',
      brief:
        'A CSV export service runs 8 Node processes on one big VM behind a cloud LB. Two processes sit near 100% CPU while six idle, RSS climbs until the OOM killer fires whenever phones download big exports, and past ~1,000 clients accept() fails with EMFILE. Find the three bad settings.',
      cols: 4.6,
      rows: 2.8,
      nodes: [
        { id: 'clients', label: 'Phones + browsers', sub: 'slow mobile links', kind: 'terminal', col: 0, row: 0.6 },
        {
          id: 'limits',
          label: 'Init script: ulimit -n 1024',
          sub: 'legacy service unit',
          col: 1.2,
          row: 1.85,
          fault: {
            answer: 'nofile',
            clue: 'Give each process more tickets',
            why: 'RLIMIT_NOFILE is still the 1024 soft limit, and every client socket, upstream socket and file uses an fd. Past ~1,000 the next accept() fails with EMFILE.',
          },
        },
        {
          id: 'workers',
          label: 'cluster, SCHED_\u200BNONE',
          sub: 'one shared listen socket',
          col: 1.2,
          row: 0.6,
          fault: {
            answer: 'reuseport',
            clue: 'Let the kernel spread connections',
            why: 'With a shared listen socket epoll wakes waiters LIFO, so the busiest workers keep winning; Node’s docs report over 70% of connections landing in 2 of 8 processes.',
          },
        },
        {
          id: 'export',
          label: 'res.write() in a for loop',
          sub: 'return value ignored',
          col: 2.5,
          row: 0.6,
          fault: {
            answer: 'pipeline',
            clue: 'Stop reading when the client is slow',
            why: 'socket.write() never blocks: when the kernel send buffer is full libuv keeps the bytes in user-space memory and returns false. Ignoring it buffers a whole 500 MB export per slow phone until the OOM killer fires.',
          },
        },
        {
          id: 'pg',
          label: 'Postgres replica',
          sub: 'COPY … TO STDOUT',
          col: 3.75,
          row: 0.6,
          fine: 'Streaming rows from a replica keeps exports off the primary; the database is not where memory or CPU is piling up.',
        },
        {
          id: 'vm',
          label: 'VM: 16 cores, 64 GB',
          sub: 'no CPU limit',
          col: 2.5,
          row: 1.85,
          fine: 'Plenty of cores and memory: six processes are idle, so the box is not too small.',
        },
      ],
      edges: [
        ['clients', 'workers', 'HTTPS'],
        ['workers', 'export'],
        ['export', 'pg', 'rows'],
        ['limits', 'workers'],
        ['vm', 'export'],
      ],
      options: [
        { id: 'reuseport', label: 'listen({ reusePort: true })', sub: 'one socket per process', is: 'SO_REUSEPORT socket sharding: each process owns a listen socket and the kernel hashes new connections across them' },
        { id: 'pipeline', label: 'pipeline(\u200Brows, gzip, res)', sub: 'waits for drain', is: 'streaming with backpressure: it pauses the source whenever res.write() returns false and resumes on drain' },
        { id: 'nofile', label: 'LimitNOFILE\u200B=1048576', sub: 'raise RLIMIT_NOFILE', is: 'raising the per-process descriptor limit so thousands of sockets fit' },
        {
          id: 'more-workers',
          label: 'Fork 16 cluster workers',
          sub: 'one per core',
          decoy: true,
          is: 'more processes on the same shared socket: epoll still wakes LIFO, so the same few workers keep winning',
        },
        {
          id: 'sndbuf',
          label: 'SO_SNDBUF = 4 MB',
          sub: 'bigger kernel buffer',
          decoy: true,
          is: 'a bigger bucket, not backpressure: a 500 MB export still overflows it and the rest piles up in user space',
        },
      ],
      metrics: [
        { label: 'Hottest worker CPU', bad: 100, good: 55, unit: '%', fixedBy: ['workers'] },
        { label: 'Peak RSS per process', bad: 7.5, good: 0.3, unit: ' GB', decimals: 1, fixedBy: ['export'] },
        { label: 'EMFILE errors', bad: 320, good: 0, unit: '/min', fixedBy: ['limits'] },
      ],
      why: [
        'A shared listen socket wakes epoll waiters LIFO and concentrates load; reusePort shards connections evenly across processes.',
        'write() returning means the bytes were copied, not delivered. Respect false and drain (or use pipeline) and cap buffered bytes per connection.',
        'Every socket is a descriptor: a 1024 soft limit turns into EMFILE at about a thousand clients.',
        'Bound every buffer and propagate “full” upstream, or the failure moves into an OOM kill.',
      ],
    },
    {
      mode: 'tune',
      id: 'os-cfs-quota',
      tab: 'Beat CFS throttling',
      title: 'Average CPU 40%, p99 has a 75 ms cliff',
      brief:
        'A Node pod runs cluster with 8 processes and a 2-CPU limit. At peak each process keeps 2 threads busy (main + V8 GC/JIT, scenario), so the quota is gone 25 ms into every 100 ms period. Serve ≥ 500 req/s per pod (scenario: 250 req/s per process) with no freeze, inside a 4-CPU limit.',
      cols: 3,
      rows: 1.6,
      nodes: [
        { id: 'svc', label: 'Service', sub: 'peak traffic', kind: 'terminal', col: 0, row: 0.3 },
        { id: 'pod', label: 'Pod: {W} Node processes', sub: '2 busy threads each', col: 1, row: 0.3 },
        { id: 'cfs', label: 'cpu.max: {L} CPU', sub: '{L}00 ms per 100 ms', col: 2, row: 0.3 },
      ],
      edges: [
        ['svc', 'pod'],
        ['pod', 'cfs', 'CPU time'],
      ],
      knobs: [
        { id: 'W', label: 'Processes per pod', kind: 'stepper', min: 1, max: 8, initial: 8, help: 'cluster workers; was os.cpus()-based' },
        {
          id: 'L',
          label: 'CPU limit',
          kind: 'choice',
          initial: 2,
          choices: [
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 4, label: '4' },
            { value: 8, label: '8' },
          ],
          help: 'resources.limits.cpu',
        },
      ],
      constraints: [
        {
          id: 'freeze',
          label: 'Frozen per 100 ms period',
          unit: ' ms',
          left: frozen,
          op: '<=',
          right: 0,
          hint: 'The quota is summed over every busy thread. How many busy threads can a limit of L CPUs feed for the whole period?',
          fail: 'More busy threads than CPUs of quota: they burn it early in the period and the whole cgroup is frozen for the rest, a p99 cliff while average CPU looks fine.',
          pass: 'Busy threads ≤ CPUs of quota, so the quota lasts the whole 100 ms period and nothing is throttled.',
        },
        {
          id: 'tput',
          label: 'Pod throughput ≥ 500 req/s',
          unit: ' req/s',
          left: { op: 'mul', args: [W, 250, { op: 'min', args: [1, { op: 'div', args: [L, T] }] }] },
          op: '>=',
          right: 500,
          hint: 'Each process serves ~250 req/s when it is not throttled. How many do you need?',
          fail: 'Not enough unthrottled processes: the pod can’t serve its share of peak traffic.',
          pass: 'Enough processes, each running at full speed.',
        },
        {
          id: 'budget',
          label: 'CPU limit ≤ 4',
          unit: ' CPU',
          left: L,
          op: '<=',
          right: 4,
          hint: 'The node pool budget caps each pod at 4 CPUs.',
          fail: 'Over the per-pod CPU budget for this node pool.',
          pass: 'Within the per-pod CPU budget.',
        },
      ],
      why: [
        'A CPU limit of 2 is 200 ms of CPU per 100 ms period, summed over every thread in the cgroup.',
        '8 processes × 2 busy threads burn it in 25 ms, then the cgroup is frozen for 75 ms: the p99 cliff.',
        'Size worker counts from the cgroup quota, not os.cpus(), which reports the host’s cores.',
        'Or raise / remove the limit for latency-sensitive services; check nr_throttled in cpu.stat.',
      ],
    },
  ],
};

export default set;
