import type { Topic } from '../../types';

const topic: Topic = {
  id: 'fund-os-kernel',
  phase: 'fundamentals',
  order: 4,
  title: 'OS & Kernel for Backend Engineers: Processes, Memory, I/O & the Durability Path',
  subtitle:
    'What the kernel is really doing under your NestJS service, Postgres and Redis: fork and copy-on-write, scheduling and CFS throttling, page faults and the OOM killer, file descriptors, epoll/io_uring, libuv, socket buffers, acceptor patterns with SO_REUSEPORT, and the full write() → fsync → device-cache → media path.',
  estimatedMinutes: 160,
  sources: [
    'Hussein Nasser — Fundamentals of Operating Systems (course), https://os.husseinnasser.com',
    'Hussein Nasser — courses index, https://www.husseinnasser.com/courses',
    'Hussein Nasser — Backend Engineering Show: "5 Backend Design Patterns for Managing Threads and Sockets" (2026)',
    'Hussein Nasser — Backend Engineering Show: "Your SSD lies but that\'s ok | Postgres fsync" (2023)',
    'Marek Majkowski (Cloudflare) — "Why does one NGINX worker take all the load?" / the sad state of Linux socket balancing (2017), https://blog.cloudflare.com/the-sad-state-of-linux-socket-balancing/',
    'NGINX/F5 — "Socket Sharding in NGINX Release 1.9.1" (reuseport benchmark)',
    'Node.js docs — net.Server.listen (reusePort, added v23.1.0 / v22.12.0; backlog default 511), cluster scheduling policy, dns.lookup implementation considerations',
    'Redis docs — Diagnosing latency issues (fork page-table cost, THP and copy-on-write, AOF fdatasync)',
    'PostgreSQL wiki — Fsync Errors ("fsyncgate", PANIC on fsync failure since 2019 minor releases); PostgreSQL docs — data_sync_retry, WAL configuration, synchronous_commit',
    'Linux man pages — fork(2), epoll(7), io_uring(7), fsync(2), open(2) O_DIRECT, proc(5); Brendan Gregg — Linux performance tools',
  ],
  tags: ['os', 'linux', 'kernel', 'processes', 'threads', 'virtual-memory', 'epoll', 'io_uring', 'libuv', 'so_reuseport', 'fsync', 'durability', 'wal', 'debugging'],
  cheatSheet: [
    'fork() copies the page table, not the memory: pages are shared copy-on-write until someone writes. A 24 GB Redis has a ~48 MB page table (24 GB ÷ 4 KB × 8 B) to copy, ~10–20 ms/GB on modern hosts; peak extra RSS during BGSAVE ≈ fraction of pages written × dataset (×2 worst case, worse with THP).',
    'Context switch: ~1–5 µs direct, plus cold caches/TLB afterwards. Thread-per-connection pays this per blocking call; an event loop pays one epoll_wait per batch of ready sockets.',
    'CFS quota: limits.cpu 2 = 200 ms of CPU per 100 ms period summed over ALL threads (libuv pool, GC, JIT). Burn it in 25 ms with 8 threads → throttled 75 ms. Read nr_throttled / throttled_usec in cpu.stat.',
    'Virtual ≠ resident: malloc and 8 MB thread stacks reserve address space; pages fault in on first touch (minor ~µs, major = disk read). Overcommit (vm.overcommit_memory 0/1/2) means the OOM killer, not malloc, tells you that you ran out. Exit 137 = SIGKILL.',
    'TLB covers only a few MB with 4 KB pages; 2 MB huge pages cut page-walks for big shared memory (Postgres huge_pages=try), but Transparent Huge Pages hurt fork-heavy Redis (copy 2 MB per touched page) — disable THP for Redis.',
    'Every socket, file, pipe, epoll and eventfd is an fd. Soft ulimit -n is often 1024; EMFILE means a leak or too-low limit. Count with ls /proc/PID/fd | wc -l; find leaks with lsof / ss -tanp grouped by state.',
    'select/poll are O(n fds) per call; epoll is O(ready). Level-triggered re-notifies while data remains; edge-triggered notifies once per change, so you must read until EAGAIN. io_uring is a completion model: submit ops into a shared ring, reap results — fewer syscalls, real async file I/O.',
    'Node: one thread runs JS and epoll (network is truly async). The libuv pool (default 4, UV_THREADPOOL_SIZE up to 1024) runs fs.*, dns.lookup (getaddrinfo), async crypto (pbkdf2/scrypt/randomBytes) and zlib. dns.resolve* and sockets do not use it.',
    'Acceptor patterns: one shared listen queue (fair latency, uneven load — epoll wakes LIFO) vs SO_REUSEPORT per-worker queues (even load, but a stuck worker stalls its own queue → fat tail; Cloudflare saw max latency 72 ms → 145 ms). Node: cluster = primary accepts + round-robin; listen({ reusePort }) since v22.12/v23.1.',
    'Durability path: write() lands in page cache (lost on crash) → fsync/fdatasync forces it to the device → device must flush its volatile cache (FLUSH/FUA) unless it has power-loss protection → media. After fsync returns EIO, the dirty pages may be gone: never retry-and-trust; crash and replay WAL (Postgres PANICs since 2019). Group commit amortises one fsync over many transactions.',
  ],
  sections: [
    {
      heading: 'Processes, threads and fork(): copy-on-write and why Postgres and Redis fork',
      body: `**Intuition:** a process is a house (its own address space, fds, credentials); threads are people sharing that house. \`fork()\` is a magic photocopier that hands you a second house instantly — because it only copies the *floor plan* (page tables) and lets both houses share the furniture until someone moves a chair.

### The mechanics
- **Process:** address space + page tables + fd table + signal handlers + credentials + one or more threads. Isolation is enforced by the MMU: a crash or stray pointer in one process cannot corrupt another.
- **Thread:** a schedulable unit (registers, stack, TLS) *inside* a process. On Linux both are \`task_struct\`s created with \`clone()\` — threads just share more (CLONE_VM, CLONE_FILES…). Cheap to create (~10–20 µs) and to switch between, but a wild write corrupts everyone.
- **fork():** the child gets a copy of the parent's page tables with every writable page marked read-only and shared. The first write by either side triggers a page fault and the kernel copies that one 4 KB page (**copy-on-write, CoW**). Cost of the fork itself ≈ copying page tables: ~8 bytes per 4 KB page, so a 24 GB process has a ~48 MB page table. Redis measured 9–13 ms per GB on physical and modern VMs, but ~240 ms/GB on old Xen EC2 — and the fork runs on Redis's main thread, so that is a full stall.

### Why Postgres forks per connection
The postmaster \`fork()\`s one backend process per client connection. History (1990s portability, no reliable threads) plus a real benefit: a backend that segfaults is isolated, and the postmaster resets shared memory and restarts cleanly. Shared state (shared_buffers, lock tables, WAL buffers) lives in an explicit shared-memory segment mapped by every backend. The cost — ~5–10 MB private memory per backend plus a fork per connection — is why poolers exist (see the connections topic); here the point is *why the architecture leans on fork*.

### Why Redis forks for BGSAVE / BGREWRITEAOF
Redis needs a consistent point-in-time snapshot without locking its single command thread. \`fork()\` gives it one for free: the child walks memory that CoW keeps frozen while the parent keeps serving writes. The bill arrives as **memory**: every page the parent writes during the snapshot is duplicated. A 10 GB dataset where 40% of pages are touched during a 2-minute save needs ~14 GB. With Transparent Huge Pages, each touched page is 2 MB instead of 4 KB, so a handful of writes can duplicate almost the whole heap — Redis tells you to disable THP. Redis reports the damage in its log ("RDB: N MB of memory used by copy-on-write") and in \`INFO\` (\`latest_fork_usec\`, \`current_cow_size\`).

| | Process | Thread | fork() + CoW child |
|---|---|---|---|
| Isolation | Strong (MMU) | None | Strong after fork |
| Create cost | ~100s µs–ms (fork+exec) | ~10–20 µs | Page-table copy, ~10 ms/GB |
| Sharing | Explicit shm / pipes | Everything | Snapshot of parent at fork |
| Typical use | Postgres backends, nginx workers | JVM servers, libuv pool | Redis snapshots, pre-fork servers |

**In interviews say:** "fork is cheap in *time* but can be expensive in *memory later*: copy-on-write turns parent writes during the child's lifetime into page copies. That is why a Redis box needs headroom of 'dataset × write-heavy fraction', THP off and vm.overcommit_memory=1."`,
      diagram: `fork() at t0                      parent writes key K at t1
+---------+   +---------+          +---------+   +---------+
| parent  |   |  child  |          | parent  |   |  child  |
| PT: RO  |   | PT: RO  |          | PT: RW  |   | PT: RO  |
+----+----+   +----+----+          +----+----+   +----+----+
     |   shared    |                    |             |
     v             v                    v             v
   [page A] [page B] [page C]       [A'] (copy)   [A] [B] [C]
   one physical copy, both RO       fault -> kernel copies 4 KB
                                    (2 MB if THP backs the page!)`,
      code: [
        {
          language: 'bash',
          title: 'Measure what fork and copy-on-write cost a Redis instance',
          code: `# How long did the last fork stall the main thread (microseconds)?
redis-cli INFO stats | grep latest_fork_usec

# During a BGSAVE: how much memory has copy-on-write duplicated so far?
redis-cli BGSAVE
redis-cli INFO persistence | grep -E 'rdb_bgsave_in_progress|current_cow_size'

# THP should be 'never' (or 'madvise') on Redis hosts
cat /sys/kernel/mm/transparent_hugepage/enabled

# Redis wants overcommit=1 so fork() does not fail on a big heap
sysctl vm.overcommit_memory

# Postgres: one OS process per connection, all children of the postmaster
ps -o pid,ppid,rss,cmd --ppid "$(head -1 /var/lib/postgresql/data/postmaster.pid)" | head`,
        },
      ],
      keyPoints: [
        'fork copies page tables; data pages are shared read-only and copied on first write.',
        'Redis fork stall ≈ 10–20 ms per GB on modern hosts; CoW memory ≈ written fraction × dataset.',
        'Disable THP and set vm.overcommit_memory=1 on Redis hosts.',
        'Postgres trades memory per connection for crash isolation via process-per-backend.',
      ],
      source: 'Redis docs — Diagnosing latency issues (latency generated by fork, THP); Hussein Nasser — Fundamentals of Operating Systems',
    },
    {
      heading: 'CPU scheduling: context switches, preemption, spinlocks vs mutexes and CFS throttling',
      body: `**Intuition:** the scheduler is a referee with a stopwatch who rotates players onto a few courts (cores). Every swap costs time to walk on and warm up; and in a container, the league also limits how many court-minutes your team gets per 100 ms.

### Context switches and preemption
- A **voluntary** switch happens when a thread blocks (read on an empty socket, mutex wait, \`sleep\`). An **involuntary** switch (preemption) happens when its time slice ends or a higher-priority task wakes.
- Direct cost is ~1–5 µs (save/restore registers, switch page tables for a *process* switch, kernel bookkeeping). The hidden cost is cold L1/L2 caches and TLB afterwards, which can double or triple the effective cost on cache-heavy code.
- Linux's CFS (and EEVDF, its replacement since kernel 6.6) gives each runnable task a fair share of CPU weighted by nice value. Many runnable threads per core ⇒ each waits its turn ⇒ queueing latency (\`r\` column in \`vmstat\` above core count is the smoking gun).

### Spinlocks vs mutexes
| | Spinlock | Mutex (futex-based) |
|---|---|---|
| Waiting | Burns CPU in a loop | Sleeps in the kernel, woken on release |
| Uncontended cost | A few ns (one atomic) | A few ns too — futex stays in user space |
| Contended cost | Wasted cycles | Two context switches (~µs) |
| Good for | Critical sections shorter than a context switch, holder never sleeps | Anything that can block or run long |
| Danger | Holder gets preempted → waiters spin a whole time slice | Lock convoys, priority inversion |

Postgres uses spinlocks only for tiny critical sections and LWLocks (sleeping) for buffer mappings and WAL insertion. In user space on an oversubscribed container a pure spinlock is a footgun: if the holder is preempted or throttled, every waiter spins uselessly. Modern mutexes are *adaptive* — spin briefly, then sleep.

### CPU throttling in containers (CFS bandwidth control)
\`resources.limits.cpu: 2\` becomes \`cpu.max = 200000 100000\`: 200 ms of CPU time per 100 ms period, summed over **every thread in the cgroup**. A Node process is not one thread — V8 runs parallel GC and JIT threads, libuv runs 4+ pool threads. If 8 threads are busy they burn the 200 ms quota in 25 ms of wall time and the whole cgroup is frozen for the remaining 75 ms. Average CPU looks fine (say 40%) while p99 gets a ~75 ms cliff. Check \`nr_throttled\` and \`throttled_usec\` in \`cpu.stat\`.

**In production:** keep request CPU = typical use, raise or remove the CPU *limit* for latency-sensitive services (or keep the limit and cap thread counts to it), and size worker counts from the cgroup quota, not \`os.cpus()\`, which reports host cores.`,
      code: [
        {
          language: 'bash',
          title: 'Prove (or disprove) CFS throttling and scheduler queueing',
          code: `# cgroup v2 inside the container: quota and period (microseconds)
cat /sys/fs/cgroup/cpu.max            # e.g. "200000 100000" = 2 CPUs
# nr_periods / nr_throttled / throttled_usec — sample twice, 10 s apart
cat /sys/fs/cgroup/cpu.stat; sleep 10; cat /sys/fs/cgroup/cpu.stat
# throttled ratio = delta(nr_throttled) / delta(nr_periods); > 5% hurts p99

# How many threads does "single-threaded" Node really run?
ls /proc/$(pgrep -f 'node dist/main')/task | wc -l

# Voluntary vs involuntary context switches for one process
grep ctxt_switches /proc/$(pgrep -f 'node dist/main')/status

# Run-queue length (r) vs cores; cs = context switches per second
vmstat 1 5
# Per-thread switches/s (sysstat): high nvcswch/s = preemption pressure
pidstat -w -t -p $(pgrep -f 'node dist/main') 1 5`,
        },
      ],
      keyPoints: [
        'Context switch ≈ 1–5 µs direct plus cache/TLB warm-up.',
        'Spin only for sections shorter than a context switch whose holder never sleeps.',
        'CFS quota is shared by all threads in the cgroup — GC and libuv threads count.',
        'Throttling shows as periodic p99 cliffs with modest average CPU; read cpu.stat.',
      ],
      source: 'Hussein Nasser — Fundamentals of Operating Systems (CPU, scheduling); Linux kernel docs — CFS bandwidth control',
    },
    {
      heading: 'Virtual memory: page faults, the TLB, huge pages, overcommit and the OOM killer',
      body: `**Intuition:** virtual memory is a hotel that hands every guest a brochure promising a whole floor. Rooms (physical pages) are assigned only when a guest actually walks in. If too many guests show up at once, the manager (OOM killer) evicts someone — without asking.

### Page faults
- Every address you touch is virtual; the MMU translates it via page tables (4 levels on x86-64) into a physical frame, normally 4 KB.
- **Minor fault:** page not mapped yet, but no disk I/O needed (first touch of malloc'd memory, CoW copy, page already in page cache). ~0.5–2 µs.
- **Major fault:** needs disk — swapped-out page or a file-backed page not in cache. 100 µs on NVMe, ~10 ms on HDD. A latency-sensitive process should see ~zero major faults (\`majflt\` in \`/proc/PID/stat\`, \`pidstat -r\`).

### The TLB and huge pages
Translations are cached in the TLB — roughly 64 L1 entries and 1.5–2K L2 entries per core. With 4 KB pages that covers only ~6–8 MB; random access over a 64 GB buffer pool misses constantly, and each miss is a page-table walk. **Huge pages** (2 MB, or 1 GB) cover ~3 GB+ with the same entries and shrink page tables 512×. Postgres with tens of GB of \`shared_buffers\` benefits from \`huge_pages = try/on\` (pre-reserved hugetlbfs pages); also each backend's page table for shared memory shrinks dramatically.

**Transparent Huge Pages (THP)** promote memory to 2 MB automatically. Good for JVM/analytics heaps; bad for fork + CoW workloads (Redis) and for sparse allocators (memory bloat, khugepaged compaction stalls). Rule: hugetlbfs for big shared buffers you own; \`madvise\` or \`never\` for THP on Redis/DB hosts.

### Overcommit and the OOM killer
Linux lets processes reserve more virtual memory than RAM + swap:
| vm.overcommit_memory | Behaviour |
|---|---|
| 0 (default) | Heuristic: refuse only obviously impossible allocations |
| 1 | Always say yes (Redis recommends this so fork never fails) |
| 2 | Strict: commit limit = swap + RAM × overcommit_ratio; malloc can fail |

Because allocation succeeds lazily, running out is discovered at *page-fault* time, when the kernel cannot back a touch. Then the **OOM killer** picks a victim by \`oom_score\` (mostly RSS, adjusted by \`oom_score_adj\`) and sends SIGKILL — exit code 137, no stack trace, no \`finally\`. In Kubernetes the same happens per cgroup when usage exceeds \`memory.max\` (status \`OOMKilled\`). What counts: anonymous RSS (V8 heap **and** native memory — Buffers, TLS, zlib, thread stacks), tmpfs, and page cache that cannot be reclaimed fast enough (dirty pages).

**In interviews say:** "A heap of 600 MB in a 1 GB pod can still OOM — RSS includes off-heap Buffers, per-thread arenas and dirty page cache. I size limits on RSS from \`/proc/PID/status\` (VmRSS) and \`memory.current\`, not on heapUsed."`,
      code: [
        {
          language: 'bash',
          title: 'Faults, RSS breakdown and OOM evidence',
          code: `PID=$(pgrep -f 'node dist/main')
# Minor/major faults per second and RSS for one process
pidstat -r -p $PID 1 5
# RSS split: anonymous (heap + Buffers + stacks) vs file-backed vs shmem
grep -E 'VmRSS|RssAnon|RssFile|RssShmem|VmSwap' /proc/$PID/status
# Who will the OOM killer pick first? Higher = sooner
cat /proc/$PID/oom_score /proc/$PID/oom_score_adj
# cgroup v2 view: usage, limit, and how often the limit was hit
cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.max
grep -E 'oom|oom_kill|max' /sys/fs/cgroup/memory.events
# Kernel log after a kill: victim, RSS, cgroup
dmesg -T | grep -iE 'out of memory|oom-kill|killed process' | tail
# Huge pages: reserved hugetlbfs pages and THP mode
grep -i huge /proc/meminfo; cat /sys/kernel/mm/transparent_hugepage/enabled`,
        },
      ],
      keyPoints: [
        'Minor fault ~µs, major fault = disk read; latency-critical processes should have no major faults.',
        'TLB reach with 4 KB pages is only a few MB; huge pages extend it ~512×.',
        'THP helps big heaps but hurts fork/CoW (Redis) and sparse allocators.',
        'Overcommit moves "out of memory" from malloc to the OOM killer (SIGKILL, exit 137).',
      ],
      source: 'Hussein Nasser — Fundamentals of Operating Systems (memory management); proc(5); Linux docs — overcommit accounting',
    },
    {
      heading: 'File descriptors: the lifecycle, ulimit and leaks',
      body: `**Intuition:** a file descriptor is a coat-check ticket. The kernel holds the coat (a socket, file, pipe, epoll instance); you hold a small integer. Lose tickets without returning them and the cloakroom fills up — then nobody new gets in.

### Lifecycle
1. **Created** by \`open\`, \`socket\`, \`accept\`, \`pipe\`, \`epoll_create\`, \`eventfd\`, \`timerfd\`… The kernel returns the lowest free number.
2. **Used** by \`read/write/send/recv\`, registered in epoll.
3. **Duplicated/inherited** by \`dup\`, \`fork\` (child inherits all fds unless \`O_CLOEXEC\` — Node sets CLOEXEC by default) — a classic leak in pre-fork servers is a child holding the listening socket or a deleted log file open.
4. **Closed** by \`close()\`. A TCP socket's fd disappears immediately, but the connection may linger in kernel states (TIME_WAIT, FIN_WAIT_2) without an fd — that is a port problem, not an fd problem.

### Limits
- Per process: \`RLIMIT_NOFILE\` (\`ulimit -n\`). Soft limit is often **1024** (and \`select()\` can't handle fds ≥ 1024 at all). systemd units and containers usually raise it (Docker typically 1048576), but check — a JVM or Node behind an old init script may still sit at 1024.
- System wide: \`fs.file-max\` / \`fs.nr_open\`. Memory per idle fd is small (~1 KB of kernel structures) — the cost of an fd is mostly what it points at (socket buffers).
- Failure mode: \`EMFILE\` (per-process) or \`ENFILE\` (system). For a server, \`accept()\` failing with EMFILE means the pending connection stays in the accept queue; a naive loop that retries immediately spins at 100% CPU.

### How Node code leaks fds
- An HTTP response that is never consumed (\`res.resume()\` missing) keeps the socket checked out of the agent.
- \`fs.promises.open()\` without \`finally { await fh.close() }\` on the error path.
- No server timeouts: half-dead clients (phones that left Wi-Fi) hold sockets forever; a slow downstream makes in-flight requests pile up, each holding an inbound and an outbound socket.
- \`fs.watch\`/inotify, child processes with \`stdio: 'pipe'\` never read.

**In production:** alert on \`process_open_fds / process_max_fds > 0.8\` (prom-client exports both), and when it climbs, group by type: sockets in CLOSE_WAIT = *your* code never closed a connection the peer already closed.`,
      code: [
        {
          language: 'bash',
          title: 'Count, classify and chase fd leaks',
          code: `PID=$(pgrep -f 'node dist/main')
# Limits actually applied to the running process (not your shell's!)
grep 'Max open files' /proc/$PID/limits
# How many fds are open right now, and what kind
ls /proc/$PID/fd | wc -l
ls -l /proc/$PID/fd | awk '{print $NF}' | sed -E 's/:\\[.*//' | sort | uniq -c | sort -rn
# Sockets owned by the process grouped by TCP state:
# many CLOSE_WAIT = we never close()d after the peer hung up (leak in our code)
ss -tanp | grep "pid=$PID," | awk '{print $1}' | sort | uniq -c
# Which remote endpoints hold them
ss -tnp state close-wait | grep "pid=$PID," | awk '{print $5}' | sort | uniq -c | sort -rn | head
# Files deleted on disk but still open (disk space not freed)
lsof -p $PID +L1 2>/dev/null | head`,
        },
      ],
      keyPoints: [
        'Everything is an fd: sockets, files, pipes, epoll, timers.',
        'Check /proc/PID/limits of the live process; soft 1024 still appears in the wild.',
        'CLOSE_WAIT piling up means your code is not closing sockets the peer closed.',
        'Unconsumed HTTP responses and missing server timeouts are the top Node fd leaks.',
      ],
      source: 'Hussein Nasser — Fundamentals of Operating Systems (file descriptors, sockets); proc(5); getrlimit(2)',
    },
    {
      heading: 'Blocking vs non-blocking I/O: select, poll, epoll (level vs edge) and io_uring',
      body: `**Intuition:** blocking I/O is waiting at the counter until your order is ready. Non-blocking readiness I/O (epoll) is a pager that buzzes "your table is ready — come and get it". Completion I/O (io_uring) is a waiter who brings the food to your table and tells you it is done.

### Blocking vs non-blocking
- **Blocking** \`read()\` on an empty socket puts the thread to sleep. Simple code, but one thread per concurrent connection → memory for stacks + context switches.
- **Non-blocking** (\`O_NONBLOCK\`) \`read()\` returns \`EAGAIN\` immediately. Useless alone (busy-polling) — you need a **readiness notification** to know *when* to retry.

### select → poll → epoll
| | select | poll | epoll |
|---|---|---|---|
| Interest set | Bitmap rebuilt each call | Array passed each call | Kept in kernel (epoll_ctl once) |
| Cost per wait | O(all fds) | O(all fds) | O(ready fds) |
| Max fds | FD_SETSIZE = 1024 | Unlimited | Unlimited |
| Used by | Legacy code | Small tools | nginx, Node/libuv, Redis, Netty |

### Level- vs edge-triggered
- **Level-triggered (default):** \`epoll_wait\` keeps reporting the fd as long as unread data remains. Forgiving: read some, come back later.
- **Edge-triggered (\`EPOLLET\`):** reported once per *transition* (new data arrived). You **must** loop \`read()\` until \`EAGAIN\`, or the leftover bytes sit there and you are never woken again → the connection silently stalls. Benefit: fewer wakeups with many threads/epoll instances; nginx uses ET.
- \`EPOLLONESHOT\` disarms after one event (useful when handing an fd to a worker thread); \`EPOLLEXCLUSIVE\` (Linux 4.5) wakes only one of several epoll instances waiting on the same fd — the cure for the accept thundering herd.

### Files are the exception
epoll does not work on regular files — a disk file is always "ready", and \`read()\` may still block on a page-cache miss. That is why libuv uses a **thread pool** for \`fs.*\`.

### io_uring (Linux 5.1, 2019)
Two ring buffers shared between user space and kernel: you put requests (read, write, accept, fsync, send…) into the **submission queue**, the kernel puts results into the **completion queue**. Batched submission means one syscall (or zero, with SQPOLL) for many ops, and it does true async *file* I/O. Trade-offs: big attack surface — Google disabled it on production servers and Android apps, and Docker's default seccomp profile blocks it; libuv enabled it for some fs ops (Node 20.3) and then turned it off by default after a 2024 security fix (\`UV_USE_IO_URING=1\` opts in). Use when syscall overhead or file I/O is the bottleneck (databases like TigerBeetle, ScyllaDB-style engines, proxies at millions of ops/s), not for a typical CRUD API.`,
      diagram: `readiness model (epoll)                 completion model (io_uring)
app            kernel                   app                kernel
 | epoll_wait -->|                       | SQE: read fd,buf ->| (shared ring)
 |<-- fd 7 ready |                       | SQE: send fd 9  -->|
 | read(7) ----->| copy data             | io_uring_enter --->| does the I/O
 |<-- n bytes    |                       |<- CQE: read=4096 --|
 | read(7) ----->|                       |<- CQE: send=512 ---|
 |<-- EAGAIN     | (edge-trig: must      | (no EAGAIN loop,
                   drain to EAGAIN)        works for files too)`,
      code: [
        {
          language: 'text',
          title: 'Edge-triggered epoll loop (C-like pseudocode) — the drain rule',
          code: `epfd = epoll_create1(EPOLL_CLOEXEC)
epoll_ctl(epfd, ADD, listen_fd, EPOLLIN | EPOLLEXCLUSIVE)

loop:
  n = epoll_wait(epfd, events, 1024, timeout_ms)   // sleeps; O(ready)
  for ev in events[0..n]:
    if ev.fd == listen_fd:
      while (c = accept4(listen_fd, NONBLOCK|CLOEXEC)) >= 0:  // drain queue
        epoll_ctl(epfd, ADD, c, EPOLLIN | EPOLLET | EPOLLRDHUP)
      if errno == EMFILE: pause_accepting()       // do not spin on EMFILE
    else:
      while true:                                  // edge-triggered: drain!
        r = read(ev.fd, buf, 64KB)
        if r > 0: handle(buf, r); continue
        if r == 0: close(ev.fd); break             // peer closed (FIN)
        if errno == EAGAIN: break                  // fully drained, wait
        close(ev.fd); break                        // real error`,
        },
      ],
      keyPoints: [
        'epoll keeps the interest set in the kernel; cost scales with ready fds, not total fds.',
        'Edge-triggered requires draining to EAGAIN or the connection stalls forever.',
        'Regular files are always "ready" — async file I/O needs a thread pool or io_uring.',
        'io_uring is a completion model with shared rings; powerful but often disabled for security.',
      ],
      source: 'epoll(7), io_uring(7); Hussein Nasser — Fundamentals of Operating Systems (async I/O)',
    },
    {
      heading: 'Node on the kernel: libuv\'s epoll loop, the thread pool and what really blocks',
      body: `**Intuition:** Node is one chef (the main thread) at a pass with a buzzer board (epoll). Network orders buzz when ready, so the chef never waits on them. Anything the buzzer cannot track — files, DNS via the system resolver, heavy crypto, compression — goes to four kitchen helpers (the libuv pool). If the chef starts hand-chopping onions (sync CPU work), nobody gets served.

### How the loop maps onto syscalls
Each turn of the libuv loop runs phases: **timers** → pending callbacks → idle/prepare → **poll** → **check** (\`setImmediate\`) → close callbacks; \`process.nextTick\` and promise microtasks drain between every callback. The **poll** phase is literally \`epoll_wait(fd, events, n, timeout)\` where *timeout* is the time until the next timer — so an idle Node process sleeps in the kernel, using zero CPU. TCP accept/read/write, UDP, pipes, signals and child-process exits are all epoll-driven: no threads involved.

### What uses the thread pool (default 4 threads)
| API | Where it runs | Why |
|---|---|---|
| \`net\`, \`http\`, \`tls\` socket I/O | Main thread via epoll | Sockets support readiness |
| \`fs.*\` (async), \`fs.promises\` | **Pool** | Files are always "ready"; reads can block on disk |
| \`dns.lookup\` (default for \`http.get('host')\`) | **Pool** | Wraps blocking \`getaddrinfo(3)\`, honours /etc/hosts and nsswitch |
| \`dns.resolve*\`, \`dns.Resolver\` | Main thread (c-ares, async UDP) | Talks to DNS directly; ignores /etc/hosts |
| \`crypto.pbkdf2/scrypt/randomBytes/randomFill\`, \`generateKeyPair\` | **Pool** | CPU-heavy |
| \`zlib\` async (\`gzip\`, \`brotliCompress\`) | **Pool** | CPU-heavy |
| \`*Sync\` APIs, \`JSON.parse\` of 50 MB, regex backtracking | **Main thread — blocks everything** | Runs inline |
| TLS handshakes' crypto, \`crypto.createHash().update\` | Main thread | Inline, but usually small |

The pool is a shared FIFO: 4 slow \`getaddrinfo\` calls (bad resolver, 5 s timeout) delay every \`fs.readFile\` behind them. \`UV_THREADPOOL_SIZE\` (max 1024) must be set in the environment before the pool is first used. Raising it helps I/O-wait work (fs, DNS), **not** CPU-bound work beyond your core count — and each pool thread counts against the CFS quota.

### Measuring it
Event-loop *delay* (how late timers fire) and *utilisation* (fraction of time the loop is not idle in epoll_wait) are the two numbers to export. Delay p99 > ~50–100 ms means callbacks are monopolising the thread; ELU near 1.0 means you need more processes or less work per request.

**In interviews say:** "Network I/O in Node is epoll, so 50K sockets cost one thread. Files, \`dns.lookup\`, async crypto and zlib go through a 4-thread pool, so they queue behind each other. Sync CPU work blocks the loop itself. I watch loop delay and ELU per pod, and I use cached or c-ares DNS for hot outbound paths."`,
      code: [
        {
          language: 'typescript',
          title: 'Event-loop delay + utilisation, and proof that dns.lookup shares the fs/crypto pool',
          code: `import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { pbkdf2 } from 'node:crypto';
import { lookup } from 'node:dns/promises';

// Histogram of how late a 10 ms timer fires = time the loop was blocked
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let lastElu = performance.eventLoopUtilization();

setInterval(() => {
  const elu = performance.eventLoopUtilization(lastElu); // delta since last sample
  lastElu = performance.eventLoopUtilization();
  console.log(JSON.stringify({
    delayP50ms: delay.percentile(50) / 1e6,   // histogram values are nanoseconds
    delayP99ms: delay.percentile(99) / 1e6,
    delayMaxMs: delay.max / 1e6,
    elu: Number(elu.utilization.toFixed(3)),   // 1.0 = never idle in epoll_wait
  }));
  delay.reset();
}, 5000).unref();

// Saturate the 4-thread pool with CPU work: ~100 ms each
for (let i = 0; i < 8; i++) pbkdf2('pw', 'salt', 300_000, 64, 'sha512', () => {});

// This lookup is async in JS but waits for a free pool thread (getaddrinfo)
const t0 = performance.now();
lookup('example.com').then(() => {
  // Expect ~2x one pbkdf2 duration: it queued behind two "waves" of 4 jobs
  console.log('dns.lookup took', Math.round(performance.now() - t0), 'ms');
});`,
        },
      ],
      keyPoints: [
        'The poll phase is epoll_wait with a timeout set by the nearest timer.',
        'Pool users: fs, dns.lookup, async crypto (pbkdf2/scrypt/randomBytes), zlib.',
        'dns.resolve* uses c-ares on the main thread and skips /etc/hosts.',
        'Export event-loop delay p99 and ELU; they diagnose blocking and saturation respectively.',
      ],
      source: 'Node.js docs — dns implementation considerations, UV_THREADPOOL_SIZE, perf_hooks; libuv design overview',
    },
    {
      heading: 'Kernel socket buffers and backpressure: Recv-Q, Send-Q and the write() that never blocks',
      body: `**Intuition:** between your code and the wire sit two kernel buckets per connection: a receive bucket the NIC fills and you drain, and a send bucket you fill and TCP drains at the speed the peer acknowledges. When a bucket is full, pressure has to flow *back* to whoever is filling it — or memory fills up somewhere else.

### The mechanics
- **Receive buffer** (\`SO_RCVBUF\`, autotuned within \`net.ipv4.tcp_rmem\`, typically 4 KB min / 128 KB default / 6 MB max). If your app stops reading, the buffer fills, TCP advertises a **zero window**, and the *sender's* kernel stops sending. This is TCP flow control — backpressure for free, end to end.
- **Send buffer** (\`SO_SNDBUF\`, \`tcp_wmem\`, 4 KB / 16 KB / 4 MB). \`write()\` copies into it and returns; it completes long before the peer receives the bytes. When it is full a blocking socket's \`write()\` sleeps; a non-blocking one returns \`EAGAIN\`.
- **Where Node hides the problem:** \`socket.write()\` never blocks. When the kernel buffer is full, libuv keeps the remaining bytes in **user-space memory** and \`write()\` returns \`false\`. If you ignore that return value and keep writing (a slow mobile client downloading a 500 MB export, a WebSocket subscriber on 2G), the process's RSS grows without bound. Correct code waits for \`'drain'\` — or uses \`pipeline()\`, which does that for you.

### Reading \`ss\`
For an **ESTABLISHED** socket:
- **Recv-Q** large and growing on the server = bytes the kernel received that *your process has not read* → the app is slow (blocked loop, CPU starved).
- **Send-Q** large = bytes sent but not yet ACKed by the peer → the network or the *peer* is slow (or its receive window is 0).
For a **LISTEN** socket the columns mean something else: Recv-Q = connections waiting in the accept queue, Send-Q = the backlog limit (covered in the networking topic).

### Backpressure as a system property
The same rule — *bound every buffer and propagate "full" upstream* — applies at every layer: kernel socket buffers, Node stream \`highWaterMark\`, Kafka consumer fetch sizes, HTTP/2 flow-control windows. A buffer without a bound just moves the failure into an OOM kill.

**In interviews say:** "\`write()\` returning means the kernel copied the bytes, not that the client got them. In Node I respect \`write() === false\` and \`'drain'\` or use \`pipeline\`, I cap per-connection buffered bytes (\`socket.writableLength\`) and drop or disconnect slow consumers."`,
      code: [
        {
          language: 'typescript',
          title: 'Streaming a large export with real backpressure (and a slow-client guard)',
          code: `import { createServer } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { createGzip } from 'node:zlib';

const MAX_BUFFERED = 8 * 1024 * 1024; // per-connection user-space cap

createServer(async (req, res) => {
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-encoding', 'gzip');
  try {
    // pipeline pauses the file stream whenever res.write() returns false
    // and resumes on 'drain' -> memory stays ~highWaterMark per stage
    await pipeline(createReadStream('/data/export.csv'), createGzip(), res);
  } catch (err) {
    res.destroy(err as Error); // client went away: free fd + buffers now
  }
}).listen(8080);

// For push-style writers (WebSocket fan-out) you must check it yourself
export function pushQuote(sock: import('node:net').Socket, line: string): void {
  if (sock.writableLength > MAX_BUFFERED) {
    sock.destroy(new Error('slow consumer')); // kernel + user buffers full
    return;
  }
  sock.write(line); // returns false when the kernel send buffer is full
}`,
        },
        {
          language: 'bash',
          title: 'Which side is slow? Read Recv-Q / Send-Q and buffer memory',
          code: `# Established connections to our API on :8080 with queue sizes + skmem
ss -tnm state established '( sport = :8080 )' | head -20
# Recv-Q high on our side  -> our process is not reading (blocked loop)
# Send-Q high on our side  -> peer/network slow; check rwnd / retransmits
ss -tni '( sport = :8080 )' | grep -E 'rtt|retrans|rcv_space|snd_wnd' | head
# Kernel autotuning bounds: min default max (bytes)
sysctl net.ipv4.tcp_rmem net.ipv4.tcp_wmem
# Total TCP memory in pages and pressure state
cat /proc/net/sockstat`,
        },
      ],
      keyPoints: [
        'write() returning means "copied to the kernel", not "delivered".',
        'Stopped reading → zero window → sender stops: TCP backpressure is end to end.',
        'Node buffers in user space when the kernel buffer is full; honour write() === false / drain.',
        'ESTABLISHED Recv-Q high = app slow; Send-Q high = peer or network slow.',
      ],
      source: 'tcp(7), ss(8); Node.js docs — stream backpressure, net.Socket.writableLength',
    },
    {
      heading: 'Listener and acceptor patterns: from one listener to SO_REUSEPORT socket sharding',
      body: `**Intuition:** a busy restaurant can have one host seating every guest (one listener), several hosts sharing one waiting line (many acceptors on one socket), or several doors each with its own line (SO_REUSEPORT). One shared line is fair to guests; separate lines spread work evenly but a slow host strands everyone in *their* line.

Following the framing of Hussein Nasser's episode on threads and sockets, five patterns cover almost every server:

| # | Pattern | Who listens / accepts / reads / processes | Examples |
|---|---|---|---|
| 1 | Single thread does everything | 1 thread: listen + accept + read + process (event loop) | Node, Redis (commands) |
| 2 | Single acceptor, N reader loops | Thread 0 accepts, hands each fd to one of N event-loop threads that read and process it | memcached, Netty boss/worker groups |
| 3 | Single reader, worker pool for processing | One loop accepts and parses; requests (not sockets) go to workers | Node + worker_threads, libuv pool |
| 4 | N acceptors on one shared listen socket | N processes/threads all accept from the same queue | nginx default, Apache prefork |
| 5 | SO_REUSEPORT socket sharding | N listening sockets on the same port, kernel hashes each new connection to one | nginx \`reuseport\`, Envoy, HAProxy |

### The accept thundering herd
In pattern 4, when a connection arrives every waiting worker can wake up, one wins \`accept()\`, the rest get \`EAGAIN\` and go back to sleep — wasted wakeups. Blocking \`accept()\` was fixed long ago (one waiter woken), but **epoll** on a shared fd still woke everyone until \`EPOLLEXCLUSIVE\` (Linux 4.5). nginx used an \`accept_mutex\` to take turns; since 1.11.3 it uses EPOLLEXCLUSIVE and \`accept_mutex\` defaults to off.

### Shared queue vs sharded queues: Cloudflare's measurements
Even with EPOLLEXCLUSIVE, epoll wakes waiters **LIFO** — the worker that most recently went back to \`epoll_wait\` gets the next connection, so the least-busy worker is reused and load concentrates (one nginx worker ~30% CPU while others idle). With \`SO_REUSEPORT\` each worker owns its queue, load evens out (13.2% vs 9.3%), but a worker blocked on a slow request strands everything hashed to its queue. In Cloudflare's CPU-heavy benchmark: single queue max latency 72.7 ms (stddev 1.6 ms) vs reuseport max 144.6 ms (stddev 25.3 ms), though median improved (30.3 → 24.7 ms). NGINX's own benchmark of a light workload showed reuseport cutting latency stddev from ~26.6 ms to ~3.2 ms and 2–3× more requests/s. **Both are true**: reuseport wins when work per request is small and uniform; a shared queue protects the tail when some requests are slow.

### Gotchas of SO_REUSEPORT
- The hash is over the 4-tuple: adding or removing a listener reshuffles, and connections sitting in a closing listener's accept queue are reset (unless you use eBPF steering / \`tcp_migrate_req\`, Linux 5.14+). Plan graceful reloads.
- Every socket that joins the group must be owned by the same effective UID (prevents port hijacking).

**In interviews say:** "Accept is rarely the bottleneck; balance and tail latency are. A shared queue gives fair latency but uneven CPU; reuseport gives even CPU but head-of-line blocking per worker. I pick reuseport for short uniform requests and keep a shared queue — or cap per-worker work — when request cost varies wildly."`,
      diagram: `pattern 4: shared accept queue          pattern 5: SO_REUSEPORT
         SYN/ACK done                             SYN/ACK done
              |                            hash(4-tuple) -> pick socket
       [ accept queue ]                     /        |         \\
       /      |       \\                  [q1]      [q2]       [q3]
     w1      w2       w3                   |         |          |
  (epoll wakes LIFO: w1 again,            w1        w2         w3
   busy workers keep winning)        (even spread; if w2 stalls,
                                       q2's clients wait)`,
      code: [
        {
          language: 'nginx',
          title: 'nginx: worker model, shared queue vs socket sharding',
          code: `worker_processes auto;          # one worker per core, each single-threaded epoll loop
worker_rlimit_nofile 200000;    # fds: client + upstream sockets per worker

events {
    worker_connections 65535;   # per worker, counts upstream connections too
    use epoll;
    # accept_mutex off;         # default since 1.11.3 (EPOLLEXCLUSIVE instead)
    # multi_accept on;          # drain the accept queue per wakeup
}

http {
    server {
        # Shared queue (default): fair tail latency, uneven worker load
        # listen 443 ssl;

        # Socket sharding: one listen socket + accept queue per worker
        listen 443 ssl reuseport backlog=4096;
        # requires Linux 3.9+; check balance with: ss -lnt 'sport = :443'
        # (one LISTEN line per worker, each with its own Recv-Q)
    }
}`,
        },
      ],
      keyPoints: [
        'Five patterns: single loop; acceptor + N loops; reader + worker pool; shared-socket acceptors; SO_REUSEPORT shards.',
        'EPOLLEXCLUSIVE (4.5) fixes the herd but epoll still wakes LIFO → uneven load.',
        'SO_REUSEPORT: even load, but per-queue head-of-line blocking fattens the tail.',
        'Listener group changes reshuffle the hash and can reset queued connections.',
      ],
      source: 'Cloudflare — the sad state of Linux socket balancing (2017); NGINX — Socket Sharding in 1.9.1; Hussein Nasser — 5 Backend Design Patterns for Managing Threads and Sockets',
    },
    {
      heading: 'Mapping it to Node: cluster vs reusePort vs worker_threads vs PM2 vs one process per pod',
      body: `**Intuition:** Node gives you several ways to use more than one core, and they differ in *who accepts the connection* and *what is shared*. Pick based on where you run (bare VM vs Kubernetes) and what is slow (I/O vs CPU).

### The options
- **cluster module:** the primary process forks N workers. With the default **round-robin** policy (all platforms except Windows) the *primary* accepts every connection and passes the fd to a worker over IPC — pattern 2 across processes. The alternative \`SCHED_NONE\` (\`NODE_CLUSTER_SCHED_POLICY=none\`) shares the listen socket (pattern 4); Node's docs report it as badly unbalanced — over 70% of connections landing in 2 of 8 processes — which is the LIFO effect above.
- **\`server.listen({ port, reusePort: true })\`** (Node v22.12.0 / v23.1.0, Linux 3.9+, FreeBSD 12+): independent processes each open their own socket and the kernel shards connections — pattern 5 with no primary in the hot path. Useful when you run N processes yourself (systemd template units, PM2 *fork* mode, a sidecar layout) on a big VM.
- **worker_threads:** threads *inside* one process, each with its own V8 isolate and event loop; they share memory only through \`SharedArrayBuffer\`/transfer. For **CPU work** (image resize, PDF, bcrypt at scale), not for accepting connections.
- **PM2 cluster mode:** a process manager on top of the \`cluster\` module (primary = PM2 daemon), plus restarts, zero-downtime reload and log handling. Fine on VMs; redundant inside Kubernetes.
- **One process per pod:** the container runs \`node dist/main.js\`; Kubernetes is the process manager, the Service/ingress is the load balancer, HPA adds replicas.

| | cluster (RR) | reusePort processes | worker_threads | PM2 cluster | 1 process / pod |
|---|---|---|---|---|---|
| Who accepts | Primary | Kernel shards | Main thread | PM2 primary | Each pod |
| Extra hop | IPC fd passing | None | Message passing | IPC | None |
| Balance | Even (RR) | Hash: even counts, not cost | n/a | Even | L4/L7 balancer |
| Failure blast radius | Primary dies → all | One process | Whole process | Daemon | One pod |
| Fits | Bare VM, legacy | Big VM, low-overhead | CPU-bound tasks | VMs with ops tooling | Kubernetes |

### In Kubernetes
Prefer **one Node process per pod** with CPU request ≈ 1 core: metrics, OOM kills, readiness and autoscaling all map one-to-one, and CFS quota is not split across a hidden process tree. Running \`cluster\` inside a pod with \`os.cpus().length\` workers is a classic bug: \`os.cpus()\` reports **host** cores (64), not the cgroup quota (2), so you fork 64 workers that throttle each other. If you must run several workers per pod (to amortise a sidecar, or for very small pods), derive the count from \`/sys/fs/cgroup/cpu.max\`.

**In interviews say:** "On Kubernetes I run one Node process per pod and scale replicas; worker_threads only for CPU-heavy work. On a large VM I'd run N processes with reusePort (or cluster round-robin when request cost is very uneven), sized to the cores I actually get."`,
      code: [
        {
          language: 'typescript',
          title: 'cluster (primary accepts) vs reusePort (kernel shards), sized from the cgroup quota',
          code: `import cluster from 'node:cluster';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

// cgroup v2 "max 100000" or "200000 100000" -> CPUs actually granted
function cgroupCpus(): number {
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(' ');
    if (quota !== 'max') return Math.max(1, Math.floor(Number(quota) / Number(period)));
  } catch { /* not in a cgroup v2 container */ }
  return availableParallelism(); // falls back to cores/affinity, not quota
}

const workers = Number(process.env.WORKERS ?? cgroupCpus());
const app = createServer((req, res) => res.end('pid ' + process.pid + '\\n'));

if (process.env.MODE === 'reuseport') {
  // Run this file N times (systemd, PM2 fork mode). Each process owns a
  // listening socket + accept queue; the kernel hashes connections.
  app.listen({ port: 8080, reusePort: true }); // Node >= 22.12 / 23.1, Linux 3.9+
} else if (cluster.isPrimary) {
  // Default SCHED_RR: the primary accepts and passes fds to workers.
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (w, code) => {
    console.error('worker ' + w.process.pid + ' exited ' + code + ', replacing');
    cluster.fork();
  });
} else {
  app.listen(8080); // in a worker this asks the primary for the handle
}`,
        },
      ],
      keyPoints: [
        'cluster round-robin: primary accepts and hands fds to workers over IPC.',
        'listen({ reusePort: true }) since Node 22.12/23.1 gives kernel sharding without a primary.',
        'worker_threads are for CPU work, not for accepting sockets.',
        'In Kubernetes, one process per pod; never size workers by os.cpus() in a container.',
      ],
      source: 'Node.js docs — cluster (How it works, schedulingPolicy), net server.listen reusePort, worker_threads',
    },
    {
      heading: 'The durability path: write() → page cache → fsync → device cache → media',
      body: `**Intuition:** handing data to \`write()\` is handing a letter to your building's front desk. \`fsync\` is walking it to the post office and getting a receipt. But the post office may also keep letters in a tray by the door (the disk's volatile cache) — a power cut can still lose them unless the office has a backup generator (power-loss protection) or you insist they file it immediately (FLUSH/FUA).

### Each hop and what can lose your data
1. **User-space buffer** (your logger, a \`BufferedWriter\`, Node stream buffer) — lost if the *process* crashes.
2. **\`write()\` → page cache** — the kernel marks pages dirty and returns in µs. Survives a process crash, lost on a **kernel crash or power loss**. Writeback happens later: \`vm.dirty_expire_centisecs\` = 30 s age, flusher wakes every 5 s, and writers are throttled at \`dirty_ratio\` (20% of RAM by default — a burst can stall writers for seconds).
3. **\`fsync(fd)\`** — writes the file's dirty data *and* metadata (size, mtime) to the device and issues a cache flush. **\`fdatasync\`** skips metadata that is not needed to read the data back (e.g. mtime) — cheaper for pre-allocated WAL segments, which is why it is Postgres's default \`wal_sync_method\` on Linux. A **new file** also needs an fsync of its **directory**, or the name may vanish after a crash even though the data blocks were written.
4. **\`O_DIRECT\`** — bypasses the page cache (DMA from your aligned buffer), used by databases with their own buffer pool (InnoDB \`O_DIRECT\`, ScyllaDB). It is **not** a durability guarantee: data may sit in the device cache; you still need \`fsync\`/\`O_DSYNC\`. \`O_DSYNC\` makes every write behave like write + fdatasync (often implemented with FUA writes).
5. **Device volatile write cache** — SSDs acknowledge into DRAM. The kernel issues a **FLUSH** command on fsync or uses **FUA** (force unit access) per write. Enterprise SSDs with **power-loss protection (PLP)** have capacitors, so the cache counts as non-volatile and flush is nearly free (fsync ~20–100 µs). Consumer SSDs without PLP must really flush (hundreds of µs to several ms). Some cheap drives or misconfigured RAID controllers **ack flushes they did not do** — the "SSD lies" problem: a 50 µs fsync on a consumer drive is a red flag, not a win. Test with \`pg_test_fsync\` and a pull-the-plug test (diskchecker.pl style).
6. **Media (NAND)** — durable. On cloud block storage (EBS, Persistent Disk) the "device" is a network-replicated volume; fsync latency ~0.5–2 ms is mostly a network round trip.

### fsyncgate: fsync errors are not retryable
In 2018 Postgres developers found that on Linux, when writeback fails (EIO on a flaky disk, ENOSPC on thin provisioning), the kernel may **mark the dirty pages clean and drop them**, report the error to one caller once, and let a **retried fsync succeed** — even though the data never reached disk. Kernels 4.13–4.16 improved reporting (errseq_t: errors are seen by an fd opened after the failure), but the pages are still gone. Postgres's fix (2019 minor releases, back-patched to 9.4): **PANIC on any data-file fsync failure** and recover from WAL; \`data_sync_retry\` (default off) exists only for OSes that keep dirty data after failure. Lesson for anyone writing storage code: after fsync fails, the only safe recovery is from your own log.

**In interviews say:** "Commit is durable only when the WAL record has been fsynced *and* the device honours flushes. write() alone survives process crashes, not power loss. And an fsync error means the data may be gone — crash and replay, never retry and trust."`,
      diagram: `app buffer --write()--> PAGE CACHE --writeback/fsync--> DEVICE CACHE --> NAND
 (process      (dirty pages,      (FLUSH or FUA            (volatile DRAM
  crash         kernel crash/      needed; PLP drives       unless PLP)
  loses it)     power loss         treat cache as safe)
                loses it)
fsync(fd)      = data + metadata of fd, then device flush
fdatasync(fd)  = data + only metadata needed to read it back
fsync(dir_fd)  = makes a newly created/renamed name durable
O_DIRECT       = skips page cache, NOT the device cache`,
      code: [
        {
          language: 'typescript',
          title: 'Crash-safe "replace a file" in Node: write tmp, fsync, rename, fsync directory',
          code: `import { open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Atomically replace config/state so a crash leaves either old or new.
export async function writeFileDurable(path: string, data: Buffer): Promise<void> {
  const tmp = join(dirname(path), '.' + process.pid + '.' + Date.now() + '.tmp');
  const fh = await open(tmp, 'wx'); // fail if it exists; new inode
  try {
    let off = 0;
    while (off < data.length) {        // write() may be partial
      const { bytesWritten } = await fh.write(data, off, data.length - off, off);
      off += bytesWritten;
    }
    await fh.sync();                   // fsync: data + size reach the device
  } finally {
    await fh.close();
  }
  await rename(tmp, path);             // atomic name swap (same filesystem)
  const dir = await open(dirname(path), 'r');
  try {
    await dir.sync();                  // persist the directory entry itself
  } finally {
    await dir.close();
  }
  // If sync() throws (EIO/ENOSPC): do NOT retry and assume success.
  // Surface the error; the caller must rebuild from a source of truth.
}`,
        },
      ],
      keyPoints: [
        'write() survives process crashes only; fsync is required for power-loss durability.',
        'New files need an fsync of the directory; rename gives atomicity, not durability.',
        'O_DIRECT bypasses the page cache, not the device cache.',
        'fsync errors may mean dropped pages: PANIC/crash and replay, never retry-and-trust.',
      ],
      source: 'PostgreSQL wiki — Fsync Errors; PostgreSQL docs — data_sync_retry, wal_sync_method; Hussein Nasser — "Your SSD lies but that\'s ok | Postgres fsync"; fsync(2), open(2)',
    },
    {
      heading: 'Group commit, WAL, checkpoints and crash recovery (redo)',
      body: `**Intuition:** instead of driving to the post office for every letter, a database writes every change into one journal (the WAL), and when several people want a receipt at once, one trip to the post office stamps all of their letters. The actual filing cabinets (data files) are tidied up later, and after a power cut the journal tells you exactly what to redo.

### Write-ahead logging
- Rule: the log record describing a change must be durable **before** the changed data page is written, and a transaction is committed when its **commit record** is durable.
- WAL is sequential and append-only (cheap even on HDD); data pages are random writes that can be deferred and coalesced in the buffer pool.
- **Torn pages:** a Postgres page is 8 KB but the OS/device may write 4 KB atomically. With \`full_page_writes = on\` the first modification of a page after each checkpoint logs the whole page image so recovery can repair a half-written page.

### Group commit
fsync costs the same whether it flushes one commit record or a hundred. When 50 sessions commit concurrently, one backend flushes the WAL up to the latest LSN and all waiters whose records are covered return together. Throughput becomes *fsyncs/s × commits per fsync*, not fsyncs/s. Postgres does this naturally (WAL flush covers everything written so far); \`commit_delay\` (µs, default 0) with \`commit_siblings\` (default 5) can wait a little to batch more. MySQL InnoDB has binlog group commit; Redis \`appendfsync always\` also clusters commands executed together into one fsync.

### Knobs that trade durability for latency
| Setting | What you lose on power loss | Typical use |
|---|---|---|
| Postgres \`synchronous_commit = off\` | Last ≤ 3 × \`wal_writer_delay\` (≈600 ms) of commits; no corruption | Analytics events, likes |
| Postgres \`fsync = off\` | Possibly the **whole cluster** (corruption) | Never in prod; throwaway test DBs |
| MySQL \`innodb_flush_log_at_trx_commit = 2\` | ~1 s of commits on OS crash | Non-critical writes |
| Redis \`appendfsync everysec\` | ~1–2 s of writes | Default compromise |

### Checkpoints and crash recovery
A **checkpoint** writes all dirty buffers to the data files and records a redo point; WAL before it can be recycled. Postgres triggers one every \`checkpoint_timeout\` (5 min) or when \`max_wal_size\` (1 GB) of WAL accumulates, spreading writes over \`checkpoint_completion_target\` (0.9) of the interval. On restart after a crash, recovery starts from the last checkpoint's redo point and **replays** (redo) every WAL record forward; uncommitted transactions simply never become visible (Postgres needs no undo pass thanks to MVCC). Trade-off: rarer checkpoints = less write amplification and fewer full-page images, but longer recovery (minutes of WAL replay) — a direct RTO knob.

**In interviews say:** "Commit latency is bounded below by one WAL fsync; group commit makes throughput scale with concurrency. Checkpoint spacing trades steady-state I/O against crash-recovery time, and \`synchronous_commit = off\` is a bounded-loss knob I'd allow per transaction for low-value writes, never \`fsync = off\`."`,
      diagram: `t ->  T1 commit  T2 commit  T3 commit       one fsync covers LSN <= 0/3A0
       |          |          |                       |
WAL: [..T1 rec..][..T2 rec..][..T3 rec..] --> flush --+--> T1,T2,T3 return OK

crash recovery:
  [checkpoint redo point] ---- replay WAL records ----> [end of WAL]
   data files may be stale      redo every change        DB consistent,
   or torn (fixed by FPW)       in LSN order             accept connections`,
      code: [
        {
          language: 'sql',
          title: 'Postgres: see fsync cost, WAL flushes and checkpoint pressure',
          code: `-- How is WAL synced, and the durability knobs in force
SHOW wal_sync_method;          -- fdatasync on Linux by default
SHOW synchronous_commit;       -- on | off | local | remote_write | remote_apply
SHOW commit_delay; SHOW commit_siblings;

-- WAL write/sync counts and time (PG 14+; times need track_wal_io_timing)
SELECT wal_records, wal_fpi, wal_bytes, wal_write, wal_sync,
       wal_sync_time
FROM pg_stat_wal;  -- PG 18 moved write/sync timing into pg_stat_io

-- Checkpoints: requested (forced by max_wal_size) vs timed
SELECT num_timed, num_requested, write_time, sync_time
FROM pg_stat_checkpointer;  -- PG 17+; older: pg_stat_bgwriter.checkpoints_*

-- Relax durability for one low-value transaction only
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO page_views(user_id, url, seen_at) VALUES (42, '/home', now());
COMMIT;  -- returns before the WAL fsync; bounded loss on power failure`,
        },
        {
          language: 'bash',
          title: 'Measure what one fsync costs on this volume',
          code: `# Postgres ships a tool for exactly this question
pg_test_fsync -f /var/lib/postgresql/data/fsync_test -s 5
# Interpret "open_datasync / fdatasync ops/sec":
#   ~10,000-50,000/s  -> PLP enterprise NVMe (or a drive that lies!)
#   ~500-2,000/s      -> cloud block volume / consumer SSD honouring flush
#   ~100-200/s        -> 7,200 rpm HDD

# fio: 4 KB sequential writes with fdatasync after each (WAL-like)
fio --name=wal --rw=write --bs=4k --size=256m --fdatasync=1 \\
    --filename=/var/lib/postgresql/data/fio.test --runtime=20 --time_based
# look at "sync percentiles" in the output, not just IOPS`,
        },
      ],
      keyPoints: [
        'Commit = commit record durable in WAL; data pages are written later by checkpoints.',
        'Group commit: one fsync acknowledges every commit whose record it covers.',
        'synchronous_commit=off gives bounded loss without corruption; fsync=off risks corruption.',
        'Checkpoint interval trades write amplification against crash-recovery time.',
      ],
      source: 'PostgreSQL docs — WAL configuration, Reliability and the WAL, synchronous_commit, pg_test_fsync; Redis docs — AOF fsync policies',
    },
    {
      heading: 'Why Postgres, Redis, Node and nginx chose their process models',
      body: `**Intuition:** every server picks a point on the same map: *isolation* (processes) vs *sharing* (threads) vs *no sharing at all* (one loop per core). The choice follows from where the system spends time — CPU, disk, or waiting on the network.

| System | Model | Why it fits | What it costs | How it scales out |
|---|---|---|---|---|
| **Postgres** | Process per connection + shared memory; background processes (WAL writer, checkpointer, autovacuum) | Crash isolation per backend; 1990s portability; work per query is CPU/disk heavy so per-connection overhead amortises | ~5–10 MB per backend, fork per connect, snapshot cost grows with connections → poolers | Connection pooler, read replicas, partitioning |
| **Redis** | Single thread executes commands; I/O threads (6.0+) for socket read/write; fork for snapshots; background threads for fsync/free | Commands are µs; one thread = no locks, atomic commands and Lua for free; bottleneck is network/syscalls, not CPU | One slow command (KEYS, big DEL) stalls all; fork + CoW memory spikes | Redis Cluster: one single-threaded shard per core |
| **Node.js** | One JS thread + epoll; libuv pool for fs/dns.lookup/crypto/zlib | Backend API work is mostly waiting on network; event loop holds 10Ks of sockets cheaply | CPU-bound work blocks everyone; uses 1 core per process | More processes (pods, reusePort, cluster) |
| **nginx** | Master + one single-threaded worker per core; epoll; optional thread pool for blocking file reads | Proxying is I/O-bound; no locks between workers; cheap memory per connection (~KBs) | Uneven load with shared accept queue; blocking module code stalls a worker | reuseport, more workers/boxes |
| **Java/Tomcat (classic)** | Thread per request (200 default max) — or virtual threads (Java 21) | Simple blocking code, uses all cores in one process | Stacks + context switches; pool exhaustion on slow deps | Bigger pools, async, or virtual threads |

### The synthesis to say out loud
- **Single-threaded is a feature when work units are tiny and shared state is hot** (Redis): no locks beats parallelism. Scale by sharding *data* across processes.
- **Processes buy fault isolation** (Postgres backends, nginx workers, Chrome tabs) at the price of memory and IPC.
- **Threads buy shared memory and multi-core in one address space** (MySQL, JVM) at the price of locking and a shared crash domain.
- **Event loops buy concurrency without threads** (Node, nginx, Redis) as long as nothing blocks the loop — the kernel's epoll is the real multiplexer.
- In 2026 most systems are hybrids: Redis has I/O threads, Postgres has parallel query workers and (from 18) async I/O, Node has worker_threads, Java has virtual threads that look like thread-per-request but schedule like an event loop.`,
      keyPoints: [
        'Postgres: processes for isolation; pay per-connection memory → poolers.',
        'Redis: single command thread because commands are µs and locks cost more.',
        'Node/nginx: event loop per core; the kernel (epoll) does the multiplexing.',
        'Modern systems are hybrids: I/O threads, parallel workers, virtual threads.',
      ],
      source: 'Redis docs — Diagnosing latency (single threaded nature); PostgreSQL docs — server architecture; Hussein Nasser — Fundamentals of Operating Systems',
    },
    {
      heading: 'Debugging toolkit: strace, perf, /proc, vmstat, iostat and ss — and what to look for',
      body: `**Intuition:** when a service is slow, the kernel already knows why — it accounts for every context switch, page fault, syscall and byte queued. These tools ask it. Use the USE method (Utilisation, Saturation, Errors) per resource: CPU, memory, disk, network, fds.

| Tool | Question it answers | Red flags |
|---|---|---|
| \`vmstat 1\` | CPU run queue, memory, swap, context switches | \`r\` > cores (CPU saturation); \`b\` > 0 (blocked on I/O); \`si/so\` ≠ 0 (swapping); \`wa\` high; \`cs\` jumps 10× |
| \`mpstat -P ALL 1\` | Per-core balance | One core at 100% \`%usr\` = single-threaded hot spot (Node loop, Redis); \`%steal\` > 5% = noisy neighbour |
| \`pidstat -u -r -w -t 1\` | Per process/thread CPU, faults, switches | \`majflt/s\` > 0, \`nvcswch/s\` high (preempted), one thread hot |
| \`iostat -xz 1\` | Disk latency and saturation | \`w_await\`/\`r_await\` rising (ms), \`aqu-sz\` > 1 sustained, \`%util\` ~100% (meaningful for HDD, not parallel NVMe) |
| \`ss -tanpm\`, \`ss -s\`, \`ss -lnt\` | Sockets by state, queues, memory | LISTEN Recv-Q near Send-Q (accept queue full); many CLOSE_WAIT (our leak); ESTAB Recv-Q growing (app not reading) |
| \`/proc/PID/{status,limits,fd,stack,sched}\` | RSS split, fd count vs limit, where a thread sleeps | VmRSS ≫ heap; fds near limit; \`voluntary_ctxt_switches\` |
| \`strace -f -tt -T -p PID\` | Which syscalls, how long | Slow \`fsync\`/\`fdatasync\`, \`connect\` timeouts, \`futex\` waits, EMFILE/EAGAIN loops. **Overhead can be 10–100×** — use briefly, or \`strace -c\` for a summary |
| \`perf top\` / \`perf record -g\` + flame graph | Where CPU time goes, user + kernel | Hot kernel symbols (\`copy_user\`, \`tcp_sendmsg\`, spinlocks); for Node run with \`--perf-basic-prof\` so JS frames are named |
| \`cat /sys/fs/cgroup/cpu.stat\`, \`memory.events\` | Container throttling and OOM | \`nr_throttled\` growing; \`oom_kill\` > 0 |
| \`dmesg -T\` | Kernel-level events | OOM kills, I/O errors (EIO = fsyncgate territory), TCP SYN flood / "possible SYN flooding", NIC resets |

### A 5-minute triage order
1. **Is it CPU?** \`vmstat\`/\`mpstat\` + \`cpu.stat\` throttling. One core pegged on a Node pod = blocked loop → profile with \`perf\` or \`--cpu-prof\`.
2. **Is it memory?** swap activity, major faults, RSS vs limit, \`memory.events\`.
3. **Is it disk?** \`iostat\` await + \`strace -e trace=fsync,fdatasync -T\` on the DB/Redis process.
4. **Is it the network or the peer?** \`ss\` queues by state, retransmits (\`ss -ti\`, \`nstat\`), accept queue overflows (\`nstat -az | grep -i listen\`).
5. **Is it a limit?** fds vs \`ulimit -n\`, ephemeral ports, conntrack table (\`dmesg\` "nf_conntrack: table full").`,
      code: [
        {
          language: 'bash',
          title: 'A copy-paste triage kit for a slow Node pod or DB host',
          code: `PID=$(pgrep -f 'node dist/main' | head -1)

vmstat 1 5                       # r vs cores, b, si/so, wa, cs
mpstat -P ALL 1 3 | tail -20     # one core 100%? %steal?
pidstat -u -r -w -t -p $PID 1 3  # per-thread CPU, majflt/s, nvcswch/s
cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.events

iostat -xz 1 3                   # r_await / w_await (ms), aqu-sz
# Count syscalls for 10 s with low output volume (still adds overhead)
timeout 10 strace -c -f -p $PID
# Only the slow durability calls of a DB / Redis process, with durations
timeout 30 strace -f -T -e trace=fsync,fdatasync -p "$(pgrep -o redis-server)"

ss -s                            # totals by state
ss -lnt                          # LISTEN: Recv-Q (queued) vs Send-Q (backlog)
nstat -az | grep -iE 'ListenOverflows|ListenDrops|RetransSegs'

# CPU flame graph incl. JS frames (start node with --perf-basic-prof)
perf record -F 99 -g -p $PID -- sleep 30
perf script > out.stacks         # feed to FlameGraph / speedscope
dmesg -T | tail -30              # OOM kills, EIO, SYN flooding, conntrack`,
        },
      ],
      keyPoints: [
        'Walk CPU → memory → disk → network → limits with the USE method.',
        'vmstat r > cores = CPU saturation; si/so ≠ 0 = swapping; b > 0 = blocked on I/O.',
        'strace is slow (10–100× syscall overhead) — use -c or narrow -e filters briefly.',
        'perf + --perf-basic-prof gives Node flame graphs with JS and kernel frames together.',
      ],
      source: 'Brendan Gregg — Linux Performance / USE method; strace(1), perf(1), ss(8), iostat(1), vmstat(8)',
    },
  ],
  codeChallenges: [
    {
      id: 'fund-os-kernel-cc-1',
      title: 'Make an append-only ledger log actually durable (and fast)',
      context:
        'A payments team wrote a tiny append-only ledger log in Node for an internal settlement service: every API call appends one JSON line and replies 200 "recorded". After a host power failure, the last ~20 seconds of entries were missing although clients had all received 200. Under load the "fix" a teammate tried (fsync every line) dropped throughput from 30K to ~800 appends/s on the cloud volume. A later disk error went unnoticed because the code retried.',
      task:
        'Rewrite the log so that a 200 is only returned once the entry is on stable storage, that concurrent appends share fsyncs instead of paying one each, that partial writes and fsync failures are handled correctly, and that a newly created segment file survives a crash.',
      starter: {
        language: 'typescript',
        title: 'ledger-log.ts (starter)',
        code: `import { appendFile, open } from 'node:fs/promises';

export class LedgerLog {
  constructor(private readonly path: string) {}

  async append(entry: object): Promise<void> {
    // "appendFile is async, so the data is safe once it resolves"
    await appendFile(this.path, JSON.stringify(entry) + '\\n');
  }

  // teammate's patch for durability: fsync after every single append
  async appendSafe(entry: object): Promise<void> {
    const fh = await open(this.path, 'a');
    await fh.write(JSON.stringify(entry) + '\\n');
    for (let i = 0; i < 3; i++) {
      try {
        await fh.sync();
        break;
      } catch {
        // transient disk hiccup, just retry
      }
    }
    await fh.close();
  }
}`,
      },
      hints: [
        'Where does appendFile\'s data live when its promise resolves? Which crash does that survive?',
        'An fsync flushes everything written to the file so far — how many waiting appends can one fsync acknowledge?',
        'What does the kernel do with dirty pages after a failed writeback, and what does that mean for a retried fsync that returns success? Also: who makes a brand-new file\'s name durable?',
      ],
      solution: {
        language: 'typescript',
        title: 'ledger-log.ts (group commit, fail-stop on fsync error)',
        code: `import { open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

type Waiter = { resolve: () => void; reject: (e: Error) => void };

export class LedgerLog {
  private fh!: FileHandle;
  private pending: Buffer[] = [];      // encoded entries not yet written
  private waiters: Waiter[] = [];      // callers waiting for those entries
  private flushing = false;
  private failed: Error | null = null; // sticky: after fsync error, stop

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<LedgerLog> {
    const log = new LedgerLog(path);
    log.fh = await open(path, 'a');       // one long-lived fd, O_APPEND
    await log.fh.sync();                  // file may be new: persist inode
    const dir = await open(dirname(path), 'r');
    try { await dir.sync(); } finally { await dir.close(); } // and its name
    return log;
  }

  append(entry: object): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    this.pending.push(Buffer.from(JSON.stringify(entry) + '\\n'));
    const p = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (!this.flushing) void this.flushLoop();
    return p; // resolves only after the fsync that covers this entry
  }

  private async flushLoop(): Promise<void> {
    this.flushing = true;
    while (this.pending.length && !this.failed) {
      const batch = Buffer.concat(this.pending);   // group commit: take all
      const batchWaiters = this.waiters;
      this.pending = [];
      this.waiters = [];
      try {
        let off = 0;
        while (off < batch.length) {               // handle partial writes
          const { bytesWritten } = await this.fh.write(batch, off, batch.length - off);
          off += bytesWritten;
        }
        await this.fh.datasync();                  // one fdatasync for N entries
        for (const w of batchWaiters) w.resolve();
      } catch (e) {
        // fsyncgate: dirty pages may already be dropped; a retry can lie.
        this.failed = e as Error;
        for (const w of [...batchWaiters, ...this.waiters]) w.reject(this.failed);
        this.waiters = [];
        this.pending = [];
        // Fail-stop: alert, mark unhealthy; recovery = restart + verify tail.
      }
    }
    this.flushing = false;
  }
}`,
      },
      explanation: `**Fixes, one by one**
- **\`appendFile\` resolving ≠ durable.** It returns once the bytes are in the page cache; a power cut loses everything not yet written back (dirty pages are flushed after ~30 s by default — matching the ~20 s gap). The solution acknowledges only after \`datasync()\` (fdatasync) returns.
- **Group commit instead of fsync-per-append.** While one flush is in flight, new entries accumulate; the next loop iteration writes them all and pays **one** fdatasync. At ~1 ms per fdatasync, throughput becomes ~1,000 flushes/s × entries per flush — tens of thousands of appends/s under concurrency, while each caller still waits for real durability (latency ≈ 1–2 fsyncs).
- **One long-lived fd** opened with \`'a'\` (O_APPEND) instead of open/close per call: fewer syscalls and no fd churn.
- **Partial writes** are looped until all bytes are written.
- **No retry on fsync failure.** After a writeback error Linux may mark pages clean and drop them; a retried fsync can succeed with the data gone (fsyncgate). The log becomes sticky-failed, rejects all waiters and new appends, and the process should be restarted and the tail verified — the same fail-stop policy Postgres adopted (PANIC).
- **Directory fsync on open** so a newly created log file's directory entry is durable, not just its data.
- **fdatasync instead of fsync**: the file length still gets persisted (needed to read data back), but mtime-only updates are skipped.`,
      followUps: [
        {
          q: 'Each fdatasync on this cloud volume takes ~1.5 ms and you have 2,000 concurrent requests. What latency and throughput do you expect, and how would you add a latency cap?',
          a: 'Roughly 1 / 1.5 ms ≈ 660 flushes/s; with 2,000 waiting callers each flush carries hundreds of entries, so throughput is bounded by write bandwidth and JSON encoding, not fsync. Latency per append ≈ waiting for the in-flight flush plus its own: ~1.5–3 ms. If you instead want bigger batches at low concurrency, add a tiny commit delay (e.g. wait up to 200 µs if fewer than N entries are pending, like Postgres commit_delay/commit_siblings) — but cap the batch size (e.g. 1 MB) so one flush never takes too long.',
        },
        {
          q: 'How would you test that this is really crash-safe, not just that the unit tests pass?',
          a: 'Unit tests cannot cut power. Use fault injection: run the writer in a VM or container on a dm-flakey / dm-log-writes device (or LazyFS) that drops unflushed writes, kill it at random points, and check the invariant "every entry acknowledged to a client is present and every line parses". Also run pg_test_fsync / fio on the real volume to confirm flushes cost what they should — a suspiciously fast fsync on a consumer SSD suggests the device ignores flushes, which no code can fix.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-cc-2',
      title: 'An auth gateway that melts down inside a 2-CPU pod on a 64-core node',
      context:
        'A NestJS-adjacent login gateway runs in Kubernetes with resources.limits.cpu: 2. It forks one cluster worker per os.cpus() entry, verifies passwords, enriches each login with a call to the profile service by hostname, and streams an audit export. Symptoms: p99 of 1.8 s with average CPU 45%, pods restarted for "too many open files", RSS climbing during exports, and outbound profile calls slow even when the profile service is healthy.',
      task:
        'Find every OS-level mistake (process model, CPU quota, event-loop blocking, thread-pool contention, fd lifecycle, socket backpressure) and rewrite the gateway so it behaves well within a 2-CPU container.',
      starter: {
        language: 'typescript',
        title: 'gateway.ts (starter)',
        code: `import cluster from 'node:cluster';
import { cpus } from 'node:os';
import { createServer, get } from 'node:http';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { findUser, exportRows } from './store';

if (cluster.isPrimary) {
  for (let i = 0; i < cpus().length; i++) cluster.fork(); // 64 on this node
} else {
  createServer((req, res) => {
    if (req.url === '/login') {
      const u = findUser(req.headers['x-user'] as string);
      const hash = pbkdf2Sync(String(req.headers['x-pass']), u.salt, 210_000, 32, 'sha256');
      if (!timingSafeEqual(hash, u.hash)) { res.statusCode = 401; return res.end(); }
      // enrich: by hostname, response never read unless status is 200
      get('http://profile.internal/v1/' + u.id, (r) => {
        if (r.statusCode !== 200) { res.end('{}'); return; }
        let body = ''; r.on('data', (c) => (body += c)); r.on('end', () => res.end(body));
      });
    } else if (req.url === '/audit-export') {
      for (const row of exportRows()) res.write(JSON.stringify(row) + '\\n'); // 2M rows
      res.end();
    } else {
      createReadStream('./static' + req.url).pipe(res);
    }
  }).listen(8080);
}`,
      },
      hints: [
        'How many CPUs does the container really get, and how many threads will 64 workers plus their V8/libuv threads try to run inside that quota?',
        'Which line keeps the event loop busy for ~100+ ms per login, and which async API would move it — where does that API run, and what else shares that place?',
        'Follow every socket and file: which ones are never consumed, never closed on error, or never time out? And what does res.write() return when a slow client stops reading?',
      ],
      solution: {
        language: 'typescript',
        title: 'gateway.ts (quota-aware, non-blocking, leak-free)',
        code: `// Run ONE process per pod (Kubernetes scales replicas). Start with
// UV_THREADPOOL_SIZE=2..4 to match the CPU quota for pbkdf2.
import { createServer, Agent, get } from 'node:http';
import { pbkdf2, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { join, normalize } from 'node:path';
import { findUser, exportRows } from './store';

const pbkdf2Async = promisify(pbkdf2);          // runs on the libuv pool
// Keep-alive pool: reuse sockets + avoid a getaddrinfo per request
const agent = new Agent({ keepAlive: true, maxSockets: 64, timeout: 2_000 });

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/login') {
      const u = findUser(String(req.headers['x-user']));
      const hash = await pbkdf2Async(String(req.headers['x-pass']), u.salt, 210_000, 32, 'sha256');
      if (!timingSafeEqual(hash, u.hash)) { res.statusCode = 401; res.end(); return; }
      const r = get('http://profile.internal/v1/' + u.id, { agent, timeout: 300 }, (pr) => {
        if (pr.statusCode !== 200) { pr.resume(); res.end('{}'); return; } // drain -> socket reused
        pr.pipe(res);
      });
      r.on('timeout', () => r.destroy(new Error('profile timeout')));
      r.on('error', () => { if (!res.headersSent) res.end('{}'); });
    } else if (req.url === '/audit-export') {
      const rows = Readable.from((function* () {
        for (const row of exportRows()) yield JSON.stringify(row) + '\\n';
      })());
      await pipeline(rows, res);                  // pauses when write() === false
    } else {
      const file = normalize(join('/app/static', req.url ?? '/'));
      if (!file.startsWith('/app/static/')) { res.statusCode = 404; res.end(); return; }
      await pipeline(createReadStream(file), res); // closes the fd on error too
    }
  } catch {
    if (!res.headersSent) res.statusCode = 500;
    res.destroy();                                 // free socket + fd now
  }
});
server.headersTimeout = 10_000;   // slowloris / dead phones cannot pin fds
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000; // > LB idle timeout to avoid races
server.listen(8080);`,
      },
      explanation: `**What was wrong and why the fix works**
- **64 workers in a 2-CPU quota.** \`os.cpus()\` reports host cores. 64 processes × (JS + GC + JIT + libuv threads) share 200 ms of CPU per 100 ms period, so the cgroup is throttled most of each period → p99 cliffs with "average 45%" CPU, plus 64× memory. Fix: one process per pod, scale replicas.
- **\`pbkdf2Sync\` on the event loop.** ~50–150 ms of CPU per login (210K iterations) blocks every other request, including health checks. The async \`pbkdf2\` runs on the libuv pool; size \`UV_THREADPOOL_SIZE\` to the CPU quota (more threads would only be throttled).
- **Thread-pool contention for DNS.** \`http.get('profile.internal')\` resolves with \`dns.lookup\` → \`getaddrinfo\` on the *same* pool that pbkdf2 saturates, so outbound calls queue behind hashing. A keep-alive agent reuses connections (no lookup per request); alternatively cache DNS or use \`dns.resolve\`-based lookup.
- **Unconsumed responses leak sockets/fds.** For non-200 the body was never read, so the socket never returns to the pool. \`pr.resume()\` drains it. Added a client timeout.
- **No server timeouts.** Half-open clients held fds forever → EMFILE. \`headersTimeout\`/\`requestTimeout\` bound them.
- **Export ignored backpressure.** 2M \`res.write\` calls for a slow client buffer everything in user space → RSS climbs. \`pipeline\` pauses the generator when the kernel send buffer and stream buffer are full.
- **\`createReadStream(...).pipe(res)\`** leaks the file fd when the client disconnects (pipe does not destroy the source) and allowed path traversal; \`pipeline\` closes both ends, and the path is normalised.`,
      followUps: [
        {
          q: 'Product wants the gateway on a single 32-core VM instead of Kubernetes. What changes in the process model, and how do you choose between cluster and reusePort?',
          a: 'Run ~30 single-threaded processes (leave cores for the kernel and pbkdf2 pool threads, with UV_THREADPOOL_SIZE kept small per process). With cluster round-robin the primary accepts every connection and passes fds over IPC — even spread, but one extra hop and a single point of failure. With listen({ reusePort: true }) under systemd or PM2 fork mode, the kernel shards connections per process with no hop. Logins are CPU-heavy and uneven (pbkdf2), so per-process queues can build a tail; I would benchmark both and probably keep round-robin, or keep reusePort with a per-process concurrency cap.',
        },
        {
          q: 'Login traffic triples during a sale. Is raising UV_THREADPOOL_SIZE to 64 the fix?',
          a: 'No. pbkdf2 is CPU-bound: with a 2-CPU quota, 64 pool threads still get 200 ms of CPU per 100 ms period, and they also trigger more throttling and starve the main thread. Throughput is capped at roughly cores ÷ CPU-seconds per hash (2 ÷ 0.1 s ≈ 20 logins/s per pod). Scale out with replicas, cache sessions so fewer requests need a hash, and put a concurrency limit with fast 429s in front of /login so the queue cannot grow without bound.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'fund-os-kernel-iq-01',
      difficulty: 'expert',
      question:
        'Our Redis primary holds a 10 GB dataset on a 16 GB VM. Every night at 02:00 the kernel OOM-kills it during BGSAVE, and on some days clients see a 1–2 second stall right as the save starts. Explain both symptoms from first principles and fix them.',
      context: 'Write-heavy workload (~40K SET/s of session data), RDB snapshots every 15 minutes plus a nightly backup job, Ubuntu defaults, VM on a public cloud.',
      whatInterviewerLooksFor: [
        'Explains fork() copying page tables and copy-on-write duplicating pages the parent writes',
        'Connects Transparent Huge Pages to 2 MB copies and near-total duplication',
        'Explains the stall as the fork itself on the main thread (page-table copy, VM fork cost)',
        'Knows vm.overcommit_memory and why Redis wants 1',
        'Gives a sizing rule and operational alternatives (replica-side persistence, smaller shards)',
      ],
      modelAnswer: `### Symptom 1 — the stall at the start
Redis calls \`fork()\` **on its single command thread**. fork copies the page table: 10 GB ÷ 4 KB × 8 B ≈ **20 MB** of page-table entries to allocate and copy, plus marking every page read-only. On modern hardware that is ~10–20 ms per GB → 100–200 ms; on some hypervisors it is an order of magnitude worse (Redis measured ~240 ms/GB on old Xen) → 1–2 s. \`INFO stats\` → \`latest_fork_usec\` confirms it.

### Symptom 2 — the OOM kill
After fork, parent and child share pages copy-on-write. The child streams the snapshot for, say, 90 s; meanwhile 40K SET/s keep touching pages, and **each first write copies a page**. With 4 KB pages, if ~40% of pages are touched during the save, RSS grows by ~4 GB → 14 GB plus the OS, buffers and the backup job's page cache → over 16 GB. With **THP enabled**, the copy unit is 2 MB, so a few thousand scattered writes duplicate nearly the whole heap → ~20 GB demand → OOM killer sends SIGKILL (exit 137) to the largest process: Redis.

### Fixes
1. **Disable THP** (\`never\` or \`madvise\`) — biggest single win.
2. **\`vm.overcommit_memory = 1\`** so fork never fails on the commit check (Redis warns about this at startup); it does not create memory, so also…
3. **Headroom rule:** RAM ≥ dataset × (1 + fraction written during a save) + OS; for write-heavy keys plan ~1.5–2× dataset, or keep \`maxmemory\` ≈ 50–60% of RAM.
4. **Move persistence off the primary:** snapshot on a replica, or use AOF with \`aof-use-rdb-preamble\` on a replica; nightly backups copy the replica's RDB.
5. **Shard smaller:** 4 × 2.5 GB primaries make each fork cheaper and each CoW spike smaller.
6. Fix the platform: modern HVM instance types; watch \`current_cow_size\`, \`latest_fork_usec\`, and alert on memory.events.

### Trade-offs
Persistence on replicas means a primary crash loses writes since the last replicated offset anyway; for session data that is acceptable.`,
      followUps: [
        {
          q: 'Why not just add 8 GB of swap so the OOM killer never fires?',
          a: 'Because Redis touching swapped pages turns µs commands into major page faults (~100 µs–10 ms each) on the single command thread, so latency collapses for every client. Redis docs explicitly treat swapping as a latency cause. Swap can be a last-resort safety net with low swappiness, but the real fix is THP off, headroom, and persistence on a replica.',
        },
        {
          q: 'The team switches to AOF only with appendfsync everysec. Does the fork problem go away?',
          a: 'No — AOF rewrite (BGREWRITEAOF) also forks and has the same CoW behaviour, and it runs whenever the AOF grows past auto-aof-rewrite-percentage. You trade periodic RDB forks for rewrite forks, and add fdatasync latency every second (done in a background thread, but a slow disk can still block write(2) on the main thread).',
        },
        {
          q: 'How would you predict the CoW peak before it happens in production?',
          a: 'Measure write rate × distinct pages touched per second during a save in staging with production-like traffic: Redis logs "N MB of memory used by copy-on-write" at the end of each save, and current_cow_size during it. Take the worst observed ratio of CoW to dataset, multiply by the production dataset, add OS and backup page cache, and alert when used_memory × (1 + ratio) approaches the limit.',
        },
      ],
      pitfalls: [
        'Saying fork copies the whole 10 GB immediately',
        'Blaming "Redis is single-threaded" without naming fork or CoW',
        'Recommending swap or a bigger box without disabling THP',
        'Not knowing that the stall is the fork on the main thread',
      ],
    },
    {
      id: 'fund-os-kernel-iq-02',
      difficulty: 'expert',
      question:
        'A client sends INSERT … COMMIT to Postgres and receives "COMMIT". Walk me through every layer the bytes cross until they are physically on flash, and tell me at which points a crash, a kernel panic or a power cut could still lose that transaction.',
      whatInterviewerLooksFor: [
        'Separates WAL durability at commit from lazy data-page writes',
        'Knows page cache, fsync/fdatasync, device volatile cache and FLUSH/FUA',
        'Mentions power-loss protection and drives that ignore flushes',
        'Knows the knobs (synchronous_commit, fsync, full_page_writes) and their loss bounds',
        'Brings replication into "durable" for real systems',
      ],
      modelAnswer: `### The happy path
1. **Backend process** executes the INSERT: modifies the heap and index pages in **shared_buffers** (RAM) and appends WAL records to **WAL buffers**.
2. On COMMIT it appends a commit record and calls \`XLogFlush\` up to that LSN: \`write()\` copies WAL into the **page cache**, then **fdatasync** (default \`wal_sync_method\` on Linux) on the WAL segment. If another backend is already flushing, it waits and is covered by that flush (**group commit**).
3. fdatasync makes the kernel submit the dirty pages to the block layer and send a **cache FLUSH** (or FUA writes) to the device.
4. The **device** writes into its DRAM cache; it acknowledges the flush when data is in non-volatile storage — or immediately if it has **power-loss protection** (capacitors).
5. Only then does Postgres reply "COMMIT". Data pages are written much later by the background writer and **checkpointer**; after a crash, recovery **replays WAL** from the last checkpoint's redo point.

### Where loss can still happen
| Failure | Loses the committed txn? |
|---|---|
| Postgres backend crash after COMMIT | No — WAL is on disk; recovery redoes it |
| Kernel panic / power cut, honest drive | No |
| \`synchronous_commit = off\` | Yes, up to ~3 × wal_writer_delay (≈600 ms) of commits, no corruption |
| \`fsync = off\` | Yes, and possible corruption |
| Consumer SSD / RAID cache **without PLP that acks flushes it didn't do** | Yes — "the SSD lies" |
| fsync error (EIO) handled by retry | Historically yes (fsyncgate); modern Postgres PANICs and recovers from WAL |
| The whole node/disk dies | Yes unless a **synchronous replica** also had it (\`synchronous_commit = on\` + \`synchronous_standby_names\`) |

### Numbers
fdatasync costs ~20–100 µs on PLP NVMe, ~0.5–2 ms on cloud block storage, ~5–10 ms on HDD — so a single session commits at most ~500–1,000 times/s on EBS-class storage; concurrency plus group commit gives far more.

### Torn pages
A crash mid-way through writing an 8 KB data page could leave half old/half new; \`full_page_writes\` logs a full image on the first change after each checkpoint so redo can rebuild it.`,
      followUps: [
        {
          q: 'How would you prove that your cloud volume or SSD honours flushes?',
          a: 'Two steps. First measure: pg_test_fsync or fio with fdatasync=1. Thousands of syncs/s on a consumer drive with no PLP is suspicious. Second, test destructively in staging with a diskchecker-style tool: a client records acknowledged writes on another machine, you cut power to the host, and after reboot you check that every acknowledged record is present. Cloud volumes are replicated network storage. There you trust the provider\'s durability SLA, and you still test that fsync is not disabled anywhere in the stack (Docker volume options, hypervisor cache mode).',
        },
        {
          q: 'Where does synchronous replication fit into this chain, and what does it cost?',
          a: 'With synchronous_commit = on and a synchronous standby, the primary waits until the standby has flushed the WAL to its own disk before it acknowledges COMMIT. remote_apply waits longer still, until the standby has replayed it. Commit latency becomes local fsync + network RTT + remote fsync. That is about +1–2 ms within one AZ, or tens of ms across regions. In return a committed transaction survives losing the primary\'s disk completely.',
        },
      ],
      pitfalls: [
        'Saying Postgres writes the table pages to disk on every commit',
        'Treating write() returning as durable',
        'Ignoring the device write cache entirely',
        'Not mentioning replication when asked about real-world durability',
      ],
    },
    {
      id: 'fund-os-kernel-iq-03',
      difficulty: 'expert',
      question:
        'You are reviewing a home-grown storage engine. Its WAL writer catches EIO from fsync(), sleeps 100 ms, retries up to 5 times and, if a retry succeeds, carries on serving. Why is that dangerous on Linux, and what should the error-handling policy be?',
      context: 'The engine runs on ext4 and XFS volumes provisioned on thin SAN LUNs that occasionally return ENOSPC/EIO during storage maintenance.',
      whatInterviewerLooksFor: [
        'Knows that failed writeback can leave pages marked clean and dropped',
        'Knows error reporting semantics (errseq_t, reported once per fd/open, 4.13–4.16 changes)',
        'Proposes fail-stop + recovery from its own log, like Postgres PANIC',
        'Considers O_DIRECT / own buffering as a structural alternative',
        'Mentions monitoring and thin-provisioning risk',
      ],
      modelAnswer: `### Why the retry lies
When the kernel's background writeback (or your fsync) fails to write a dirty page, Linux traditionally **reports the error and marks the page clean** — it may even evict it. The data you wrote now exists nowhere: not in the page cache, not on disk. A **second fsync has nothing dirty left to flush and returns 0**. Your engine concludes "durable" and acknowledges commits whose bytes are gone. This is "fsyncgate" (2018), discovered by Postgres developers.

Kernel changes improved *reporting* — 4.13 introduced \`errseq_t\` per file, and 4.14/4.16 made sure an error is reported to at least one fd even if it was opened after the failure — but each error is still reported **once**, and the pages are still not kept dirty. Other OSes differ (some keep pages dirty), which is why Postgres exposes \`data_sync_retry\` but defaults it off.

### The right policy
1. **Fail-stop:** treat any fsync/fdatasync error on WAL or data files as fatal for the process — stop accepting writes and crash (Postgres: PANIC).
2. **Recover from your own log:** on restart, redo from the last checkpoint; anything not durably in the WAL is treated as not committed. Clients that got no ack retry with idempotency keys.
3. **Never let a different fd swallow the error:** a single long-lived fd per WAL segment, or check errors from the fd that wrote the data.
4. **Structural option:** use \`O_DIRECT\` + your own buffer pool (and fsync/\`O_DSYNC\` for the device cache), so the page cache never holds the only copy of dirty data; the error surfaces on your write.
5. **Operations:** alert on kernel I/O errors in \`dmesg\`; for thin LUNs, monitor pool free space and reserve capacity, because ENOSPC at the SAN layer becomes EIO at your fsync.

### Trade-off
Fail-stop reduces availability (a restart, possibly a failover) to preserve correctness — the correct choice for a database. A cache or log shipper may choose "drop and alert" instead, but must never claim durability.`,
      followUps: [
        {
          q: 'Could the engine keep its own copy of unflushed data and rewrite it after an error instead of crashing?',
          a: 'Yes, and that is the structural fix. If the engine keeps every WAL byte in its own memory until fsync succeeds, it can reopen the file, rewrite those ranges and fsync again. This is safe because it no longer depends on the kernel\'s dropped pages. Most engines still crash, because the error usually means the device is unhealthy. Restart plus failover to a replica is simpler and well tested. A rewrite loop on a dying disk only delays the inevitable.',
        },
        {
          q: 'Does this only matter for databases? What about an application writing JSONL logs or a local queue?',
          a: 'It matters wherever you acknowledge after fsync. Examples: a local spool for outbound webhooks, an embedded queue, a payment ledger file. If such code retries fsync and then reports success, it can lose data while claiming durability. For plain logs that you only ship best-effort, losing a few lines is acceptable. Do not claim durability for them, and alert on the I/O error.',
        },
      ],
      pitfalls: [
        'Assuming fsync errors are transient and safely retryable',
        'Believing a newer kernel "fixed" it so pages stay dirty',
        'Proposing to call fsync from a different fd opened later as a check',
        'Ignoring thin provisioning / ENOSPC as a source of EIO',
      ],
    },
    {
      id: 'fund-os-kernel-iq-04',
      difficulty: 'hard',
      question:
        'We are building an internal L7 proxy that must hold 200K concurrent mostly-idle connections and push ~1M small requests per second on a 32-core box. Would you build it thread-per-connection, on epoll, or on io_uring? Defend the choice with numbers.',
      whatInterviewerLooksFor: [
        'Quantifies thread-per-connection memory and context-switch costs',
        'Explains epoll readiness vs io_uring completion and where syscall overhead matters',
        'Chooses a thread/loop-per-core architecture with SO_REUSEPORT or acceptor distribution',
        'Raises operational concerns: io_uring security/seccomp, kernel versions, observability',
      ],
      modelAnswer: `### Thread-per-connection: rule it out with arithmetic
200K threads × (16 KB kernel stack + ≥ 8–64 KB touched user stack + TCB) ≈ **5–16 GB** of RAM for stacks alone, and kernel limits (\`threads-max\`, \`pid_max\`, \`vm.max_map_count\`) start to bite. Worse is scheduling: at 1M req/s with ~2 blocking transitions each, that is ~2M context switches/s × ~3 µs ≈ **6 CPU-seconds per second** — 6 of 32 cores spent switching, before cache effects. Virtual threads (Java 21) or goroutines fix the memory side, but they still sit on an epoll-style poller underneath.

### epoll, one event loop per core
- 32 worker threads, each with its own epoll instance and connections pinned to it (no locks on the hot path) — the nginx/Envoy model.
- Distribute accepts with **SO_REUSEPORT** (one listener per worker; requests are small and uniform, so per-queue head-of-line blocking is not a concern) or a dedicated acceptor that hands fds round-robin.
- Memory per idle connection ≈ a few KB of user state + kernel socket structures; receive/send buffers autotune from small, so 200K idle sockets fit in ~1–2 GB.
- Cost per request: \`epoll_wait\` amortised over many ready fds, plus \`read\` + \`write\` (+ upstream \`read/write\`) ≈ 4+ syscalls; at ~0.5–1 µs each with mitigations, 1M req/s needs ~4M syscalls/s ≈ 2–4 cores of pure syscall overhead. Fine on 32 cores.

### io_uring: when it earns its keep
Batching submissions (and multishot accept/recv, registered buffers) can cut syscalls per request close to zero, which matters at **millions of ops/s per box** or when you also do file I/O (caching proxy writing to disk). Costs: kernel ≥ 5.x with feature gaps per version, history of CVEs (Google disabled it on production servers; Docker's default seccomp profile blocks it), harder debugging (strace sees little).

### My choice
epoll, one loop per core, SO_REUSEPORT, written in a runtime that does this well (Rust/tokio, Go, C++ or Envoy itself). Design the I/O layer behind an interface, benchmark, and enable io_uring later for the hot path if profiles show syscall overhead > ~20% of CPU and the platform allows it.`,
      followUps: [
        {
          q: 'Could we just write it in Node with cluster to save engineering time?',
          a: 'For 200K idle connections, yes: Node holds them cheaply on epoll. For 1M req/s it is risky. Each Node process does roughly 20–50K simple proxied req/s, so you would need 20–50 processes. With cluster round-robin every accept passes through the primary over IPC; reusePort removes that hop. GC pauses add tail latency, and HTTP parsing in JS costs more per request than in Rust or C++. I would prototype Envoy first and only build custom code if Envoy cannot do the job.',
        },
        {
          q: 'Which kernel limits would you raise before the load test?',
          a: 'Raise RLIMIT_NOFILE above 2 × connections, since each client connection may also have an upstream one: ~500K+. Also raise fs.file-max and fs.nr_open. Set net.core.somaxconn and the listen backlog to ~4096+. Widen net.ipv4.ip_local_port_range and reuse upstream connections to avoid running out of ephemeral ports. Size the conntrack table if iptables/NAT is involved. Check the tcp_mem pressure thresholds, and plan IRQ/RSS queue affinity so NIC interrupts are spread across cores.',
        },
      ],
      pitfalls: [
        'Claiming io_uring is always faster without naming the syscall bottleneck',
        'Forgetting kernel stack and scheduler cost of 200K threads',
        'Ignoring accept distribution across cores',
        'No mention of the security posture of io_uring in production',
      ],
    },
    {
      id: 'fund-os-kernel-iq-05',
      difficulty: 'hard',
      question:
        'Twenty minutes after the payments provider started responding slowly, our Node API pods began logging "EMFILE: too many open files" and then crash-looped, although traffic was flat. Explain the chain of events at the file-descriptor level and how you would harden the service.',
      context: 'Node 22 pods, soft RLIMIT_NOFILE 1024 inherited from an old base image, outbound calls via a custom http.Agent with keepAlive and no maxSockets, no request timeouts on the provider client.',
      whatInterviewerLooksFor: [
        'Uses Little\'s Law to show in-flight requests (and sockets) growing with latency',
        'Knows each request holds inbound and outbound fds; agent without maxSockets opens new sockets',
        'Recognises CLOSE_WAIT and unconsumed responses as leaks',
        'Hardens with timeouts, bounded pools, limits and alerts — not just raising ulimit',
      ],
      modelAnswer: `### The chain
1. **Little's Law:** in-flight = arrival rate × latency. At 150 req/s per pod with the provider at 200 ms, ~30 requests are in flight. When the provider slowed to 8 s and nothing timed out, that became **~1,200** in flight.
2. Each in-flight request holds **at least two fds**: the inbound client socket and an outbound socket to the provider. An \`Agent\` with no \`maxSockets\` opens a new socket for every concurrent request, so outbound sockets grow with concurrency.
3. Clients and the load balancer give up at 30–60 s and close their side. Our sockets go to **CLOSE_WAIT**, because our code never calls \`close()\` while the handler is still awaiting the provider. They still hold fds.
4. Error responses whose bodies were never read keep sockets checked out of the agent, so even "finished" requests leak.
5. At ~1,024 fds \`accept()\` fails with EMFILE (new connections pile up in the kernel accept queue), \`fs.open\` for logs and TLS files fails, and DNS fails. Then the liveness probe fails → restart → a cold pod gets the same backlog → **crash loop**.

### Diagnose
\`ls /proc/PID/fd | wc -l\` vs \`grep "open files" /proc/PID/limits\`; \`ss -tanp\` grouped by state (CLOSE_WAIT to the LB, ESTABLISHED to the provider); the \`process_open_fds\` metric shows a ramp that matches the provider's latency curve.

### Harden
- **Timeouts everywhere:** a provider client timeout around p99.9 + margin (e.g. 2 s), an overall request deadline, and server \`requestTimeout\`/\`headersTimeout\`.
- **Bounded outbound pool:** \`maxSockets\` per host (e.g. 50) with a short queue wait, plus a **circuit breaker/bulkhead** that fails fast with 503 once the pool is saturated.
- **Clean up on client abort:** on \`req.on('close')\`, abort the outbound call with an AbortController so CLOSE_WAIT sockets are freed.
- **Always consume or destroy responses** (\`res.resume()\` on non-2xx).
- **Raise the limit appropriately** (\`LimitNOFILE\` / container default ~1M): this buys headroom but does not fix the leak.
- **Alert** at open_fds / max_fds > 0.7, and make liveness independent of downstream health.`,
      followUps: [
        {
          q: 'After the fix, CLOSE_WAIT is near zero but thousands of TIME_WAIT sockets appear toward the provider. Is that a leak too?',
          a: 'No. TIME_WAIT sockets have no fd, and they belong to whichever side closed first, here us after timeouts or Connection: close. They cost ephemeral ports, not fds. With 28K–60K ports per destination IP:port and a 60 s TIME_WAIT, sustained churn above ~500 new connections/s can exhaust them. Keep-alive reuse inside a bounded pool is the real fix. Avoid shortening TIME_WAIT with hacks.',
        },
        {
          q: 'Why did the crash loop never recover on its own even after the provider came back?',
          a: 'Each restarted pod got a burst of backlog right away: client retries, plus LB connections redistributed from the other crashing pods. It hit the same fd and concurrency ceiling before warming up, and liveness killed it again. Recovery needs load shedding: readiness that stays false until the pod is warm, fast 503s when concurrency is above the limit, and client retries with jittered backoff. Pausing the liveness kill during the incident also stops the spiral.',
        },
      ],
      pitfalls: [
        'Just raising ulimit to a million and calling it fixed',
        'Confusing TIME_WAIT (no fd) with CLOSE_WAIT (our fd leak)',
        'Missing that each request holds both inbound and outbound fds',
      ],
    },
    {
      id: 'fund-os-kernel-iq-06',
      difficulty: 'expert',
      question:
        'We enabled `reuseport` on our nginx edge to fix "one worker is always at 90% CPU while others idle". CPU is now perfectly balanced and median latency dropped, but p99.9 got 3× worse. Explain both the original imbalance and the new tail.',
      context: 'nginx terminates TLS and serves a mix of tiny API proxies and a few heavy endpoints (image resizing via a blocking third-party module, ~300 ms of CPU each). 16 workers on 16 cores.',
      whatInterviewerLooksFor: [
        'Explains the shared accept queue with epoll waking LIFO (Cloudflare analysis)',
        'Explains SO_REUSEPORT per-socket queues and per-worker head-of-line blocking',
        'Connects the tail to the blocking module and uneven request cost',
        'Offers fixes: isolate heavy work, thread pools, separate listeners, or revert with reasons',
      ],
      modelAnswer: `### Why one worker was hot before
Without reuseport all 16 workers wait in \`epoll_wait\` on the **same** listening socket. With EPOLLEXCLUSIVE only one is woken per connection, but wakeups are **LIFO**: the worker that most recently returned to epoll_wait, usually the one that just finished work and is "warm", gets the next connection. Under moderate load the same few workers keep winning, so CPU concentrates. Cloudflare measured one nginx worker at ~30% CPU while others had almost nothing. Latency was still good, because a free worker always picks up the shared queue: no connection waits behind a busy worker.

### Why the tail got worse with reuseport
With \`listen ... reuseport\` each worker has its **own** listening socket and accept queue, and the kernel hashes the 4-tuple to pick one. Distribution is even by *count*, not by *cost*. When a worker runs a 300 ms blocking resize, it is not in epoll_wait. Every connection hashed to its queue during that time waits, even if 15 other workers are idle. It is supermarket checkout lines: separate lines are balanced on average, but a slow customer strands everyone behind them. Cloudflare's CPU-heavy benchmark showed exactly this: median improved (30 → 25 ms) while max latency doubled (73 → 145 ms) and stddev jumped from 1.6 to 25 ms.

### Fixes, in order of preference
1. **Remove the blocking work from the event loop:** move image resizing to a separate service, or use nginx \`aio threads\` / thread pools where the module supports it. With uniform cheap requests, reuseport's tail is fine.
2. **Separate listeners:** keep heavy endpoints on a different port/server block without reuseport (or on a different nginx tier), and use reuseport only for the cheap API traffic.
3. If neither is possible, **revert to the shared queue**. Uneven CPU is cosmetic when you are under 70% total, whereas the p99.9 regression is user-visible.
4. Validate with per-worker metrics: the LISTEN \`Recv-Q\` per socket in \`ss -lnt\` shows which shard is backing up.`,
      followUps: [
        {
          q: 'Could you keep reuseport and avoid stranded connections when a worker is slow?',
          a: 'Linux offers programmable steering: SO_ATTACH_REUSEPORT_EBPF lets a BPF program choose the socket. Some proxies use it to skip unhealthy or busy listeners, and to migrate queued connections when a listener closes (tcp_migrate_req, 5.14+). That is complex. Making per-request cost uniform, or isolating heavy work, gets you most of the benefit with none of the BPF maintenance.',
        },
        {
          q: 'During nginx reloads we now see a small spike of connection resets. Why only with reuseport?',
          a: 'On reload, old workers close their listening sockets and new workers open new ones. With reuseport the reuseport group changes, so the hash reshuffles. Connections already completed in a closing socket\'s accept queue are reset, because no process will accept them. A shared listening socket is inherited by new workers, so the queue survives. Mitigations are newer nginx/kernel features (tcp_migrate_req), or draining at the load balancer before a reload.',
        },
      ],
      pitfalls: [
        'Saying reuseport is strictly better and the tail must be something else',
        'Not knowing epoll wakes waiters LIFO',
        'Not connecting the tail to per-queue head-of-line blocking',
      ],
    },
    {
      id: 'fund-os-kernel-iq-07',
      difficulty: 'medium',
      question:
        'Rapid-fire: how can one Node.js process hold 50K mostly-idle WebSocket connections on a single thread, when a classic thread-per-request Java server struggles at a few thousand? Where does each design spend its memory and CPU?',
      whatInterviewerLooksFor: [
        'Names epoll and readiness notification as the multiplexer',
        'Quantifies per-thread memory (stack, kernel stack) vs per-connection state',
        'Mentions context switches and scheduler run-queue cost',
        'Knows the event loop\'s weakness (CPU work blocks all) and the virtual-thread middle ground',
      ],
      modelAnswer: `### Node: one thread, the kernel does the waiting
Each connection is a non-blocking socket registered **once** with epoll. The single JS thread sleeps in \`epoll_wait\` and wakes only for sockets that have data, so cost is O(ready connections), not O(total). Memory per idle connection is a few KB: the JS objects for the socket and WebSocket state, plus small kernel socket structures (receive/send buffers autotune from small and grow only under traffic). 50K × ~10 KB ≈ **0.5 GB**. CPU is spent only on messages.

### Thread-per-request: the thread *is* the waiting mechanism
Each connection needs a thread blocked in \`read()\`. Per thread: a user stack (Java default \`-Xss\` 1 MB reserved, tens to hundreds of KB touched), a 16 KB kernel stack and a scheduler entry. 5K threads ≈ 0.5–1+ GB, and limits (\`ulimit -u\`, \`threads-max\`, max_map_count) appear. Every message means a wakeup and a context switch (~1–5 µs plus cache pollution). With thousands of runnable threads, run queues grow and latency becomes scheduler-bound. Classic Tomcat caps at 200 threads, so the 201st concurrent request queues.

### The trade-off
- The event loop wins on **idle concurrency** and memory. It loses when any handler does CPU work, because one 100 ms JSON parse stalls all 50K connections. Use worker_threads or more processes for that.
- Thread-per-request wins on **simplicity** (blocking code, natural stack traces) and multi-core use in one process.
- **Java 21 virtual threads / Go goroutines** give blocking-style code on top of an epoll-style poller: KB-sized stacks and user-space scheduling, which is why they are the modern default.

**One-liner:** "Node multiplexes in the kernel with epoll, so idle connections cost KBs; threads multiplex in the scheduler, so each costs a stack and context switches."`,
      followUps: [
        {
          q: 'All 50K clients receive a broadcast at the same instant. What happens to the single Node thread?',
          a: 'It serialises 50K socket.write calls, at maybe 5–20 µs each including framing: 0.25–1 s during which no other event is handled. Slow clients also fill their kernel send buffers, and Node buffers the rest in user space. Fixes: pre-serialise the frame once, split the fan-out into chunks with setImmediate so the loop can breathe, spread connections across more processes, and drop or disconnect clients whose writableLength exceeds a cap.',
        },
        {
          q: 'Would raising -Xss to 256 KB let the Java server reach 50K threads?',
          a: 'It cuts reserved address space, but 50K threads still need 50K × 16 KB = 800 MB of kernel stacks plus touched user stack pages. Scheduling still costs a context switch per message, and the OS thread limits must be raised. It can work on a big box, but virtual threads (or an NIO/Netty design) solve the problem structurally instead of tuning around it.',
        },
      ],
      pitfalls: [
        'Saying Node is "multi-threaded under the hood for sockets" (sockets use epoll, not the pool)',
        'Claiming an idle connection costs its full 6 MB max receive buffer',
        'Ignoring the CPU-bound weakness of the event loop',
      ],
    },
    {
      id: 'fund-os-kernel-iq-08',
      difficulty: 'hard',
      question:
        'On a 64 GB Postgres host, the kernel OOM killer killed one backend running a huge hash join — and then every client was disconnected and the database ran crash recovery for 40 seconds. Why did killing one process take down the whole server, and how should the host be configured?',
      context: 'Ubuntu defaults: vm.overcommit_memory = 0, swap disabled, shared_buffers = 16 GB, work_mem = 256 MB, max_connections = 400, a monitoring agent and a backup tool on the same host.',
      whatInterviewerLooksFor: [
        'Explains that SIGKILL of a backend makes the postmaster assume shared-memory corruption and reinitialise',
        'Explains overcommit making allocations succeed until page-fault time',
        'Knows Postgres guidance: overcommit_memory=2, oom_score_adj for the postmaster',
        'Sizes memory: shared_buffers + work_mem × sorts × connections',
      ],
      modelAnswer: `### Why one kill becomes an outage
Postgres backends share a memory segment (shared_buffers, lock tables, WAL buffers). If a backend dies **abnormally**, for example SIGKILL from the OOM killer mid-update, the postmaster cannot know whether it left shared memory half-modified. So it **terminates every other backend**, reinitialises shared memory and runs **crash recovery** (WAL redo from the last checkpoint). That is the 40 s outage: replaying the WAL since the last checkpoint. This is the downside of process-per-connection with shared memory: the processes are isolated from each other's private memory, but not from shared state.

### Why the OOM killer fired at all
With \`vm.overcommit_memory = 0\` the kernel happily grants allocations. A hash join can use \`work_mem\` **per hash node, per parallel worker**, and hash tables can exceed it (\`hash_mem_multiplier\`, default 2). The memory is touched page by page; when no free page is left at fault time, the OOM killer picks the process with the highest \`oom_score\` (largest RSS): the backend doing the join. No error reached Postgres; it got SIGKILL.

### Configure the host
1. **\`vm.overcommit_memory = 2\`** with a sensible \`overcommit_ratio\` (or \`overcommit_kbytes\`) so that allocations beyond the commit limit fail with ENOMEM. Postgres then raises "out of memory" for **that query only** and the rest of the server keeps running. This is the Postgres docs' recommendation.
2. **Protect the postmaster:** start it with \`oom_score_adj = -1000\` and let children reset to 0 (\`PG_OOM_ADJUST_FILE\` / \`PG_OOM_ADJUST_VALUE\`). Better a backend dies than the postmaster.
3. **Size memory honestly:** 16 GB shared_buffers + 400 connections × a few sort/hash nodes × 256 MB can promise ~100+ GB. Lower work_mem globally (e.g. 16–32 MB), raise it per session for known analytics jobs, and put a pooler in front so active backends ≈ cores × 2–4, not 400.
4. **Huge pages for shared_buffers** (\`huge_pages = on\`) reduce page-table memory per backend.
5. **Recovery time:** keep \`checkpoint_timeout\` / \`max_wal_size\` aligned with the RTO, and move side tools (backup, agents) into limited cgroups.`,
      followUps: [
        {
          q: 'Why not just enable swap so the join spills instead of being killed?',
          a: 'Postgres already spills sorts and hashes to temp files when it knows its budget. Swap would page out arbitrary memory: shared_buffers pages or other backends\' hot data. Every client would then see major-fault latency, which is a slow brownout instead of one failed query. A small swap with low swappiness as a safety net is debated. The primary fix is strict overcommit plus realistic work_mem and connection counts.',
        },
        {
          q: 'The same database runs in Kubernetes with a 64 Gi memory limit. Does overcommit_memory=2 still save you?',
          a: 'Not fully. The commit limit is host-wide, but the cgroup limit is enforced at page-charge time. Exceeding memory.max triggers the cgroup OOM killer even if host-wide commit accounting allowed the allocation. So you need explicit sizing: work_mem × concurrency + shared_buffers + page-cache needs, kept under the limit with margin. Use Guaranteed QoS so other pods cannot pressure the node, and an operator that sets oom_score_adj for the postmaster.',
        },
      ],
      pitfalls: [
        'Thinking only the killed query fails, as with a thread crash in Java',
        'Not knowing overcommit means malloc rarely fails on Linux by default',
        'Multiplying work_mem by connections only once (it is per node, per worker)',
      ],
    },
    {
      id: 'fund-os-kernel-iq-09',
      difficulty: 'hard',
      question:
        'You have SSH access to a Linux VM where a NestJS service and its local Redis sidecar intermittently show 300–800 ms latency spikes. Application metrics show nothing obvious. Walk me through the first 10 minutes using only OS tools: what do you run, in what order, and what output would change your hypothesis?',
      whatInterviewerLooksFor: [
        'A systematic order (USE method): CPU → memory → disk → network → limits',
        'Knows what specific columns mean (vmstat r/b/si/so/st, iostat await, ss queues)',
        'Uses strace/perf carefully, knowing their overhead',
        'Correlates spikes with periodic events (fork/BGSAVE, fsync, cron, throttling)',
      ],
      modelAnswer: `### 0. Frame it
Intermittent spikes of a few hundred ms usually come from something **periodic** that blocks a single-threaded process: a Redis fork or fsync, a GC, CPU throttling, swap-in, a cron job hammering the disk, or noisy neighbours (steal). Note the spike timestamps first.

### 1. CPU (1–2 min)
- \`vmstat 1\`: \`r\` above core count = CPU saturation; \`st\` > 5% = hypervisor steal (noisy neighbour); \`cs\` jumping during spikes.
- \`mpstat -P ALL 1\`: one core at 100% \`%usr\` during a spike = a busy single-threaded process (Node loop or Redis).
- \`pidstat -u -t 1\` to see which thread.

### 2. Memory (1–2 min)
- \`vmstat\` \`si/so\` non-zero = swapping → major faults on the hot path. \`pidstat -r\` \`majflt/s\` for node and redis-server.
- \`free -m\`, \`/proc/meminfo\` Dirty and Writeback: big dirty totals precede writeback storms.

### 3. Disk (2 min)
- \`iostat -xz 1\`: \`w_await\` jumping to 100s of ms during spikes = the disk. Then \`strace -f -T -e trace=fdatasync,fsync,write -p $(pidof redis-server)\` to see slow \`fdatasync\` (AOF everysec). Redis's own \`INFO persistence\` / \`latest_fork_usec\` and \`LATENCY LATEST\` confirm fork or AOF stalls.
- \`pidstat -d 1\` to find who is writing (backup, log rotation, a cron job).

### 4. Network and limits (2 min)
- \`ss -tnm\`: Recv-Q growing on Redis or app sockets = the process is not reading (blocked). \`nstat -az | grep -iE 'Retrans|ListenOverflow'\`.
- \`ls /proc/PID/fd | wc -l\` against the limit; \`dmesg -T\` for OOM, I/O errors, conntrack or SYN flood messages.

### 5. Profile the moment (remaining time)
- \`perf record -g -p PID -- sleep 30\` across a spike (Node with \`--perf-basic-prof\` for JS frames) → flame graph. Kernel frames such as \`copy_page\` / page-fault handlers point at fork/CoW; \`ext4_sync_file\` points at fsync.
- Avoid leaving \`strace\` attached: it can slow syscalls 10–100×.

### What changes the hypothesis
\`st\` high → move instance type or host; \`w_await\` + fdatasync slow → separate the AOF disk, or no-appendfsync-on-rewrite; \`latest_fork_usec\` large → THP off / smaller dataset; \`nr_throttled\` rising in \`cpu.stat\` → CPU limits.`,
      followUps: [
        {
          q: 'iostat shows w_await jumps to 400 ms every 30 seconds even though the app writes little. What do you suspect?',
          a: 'Periodic writeback of dirty page cache. dirty_expire_centisecs defaults to 30 s, so a log-heavy process or a backup builds up dirty pages and the flusher writes them in a burst that saturates the volume. Any fsync arriving then, such as Redis AOF, waits behind the burst. Check Dirty/Writeback in /proc/meminfo. Fix with lower vm.dirty_background_bytes so writeback is smoother, a separate volume for AOF/WAL, or throttle the bulk writer with an io.max cgroup.',
        },
        {
          q: 'perf shows most spike time inside kernel page-fault handlers right after Redis starts a BGSAVE. What next?',
          a: 'That is copy-on-write: the parent faults and copies pages it writes while the child snapshots. Check /sys/kernel/mm/transparent_hugepage/enabled. With THP each fault copies 2 MB, which matches long stalls. Set it to never or madvise and restart Redis. Then compare current_cow_size and latest_fork_usec, and move snapshots to a replica if CoW memory is still high.',
        },
      ],
      pitfalls: [
        'Starting with application code or restarting the service before collecting evidence',
        'Leaving strace attached in production under load',
        'Ignoring hypervisor steal time on cloud VMs',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'fund-os-kernel-boe-1',
      question:
        'A wallet ledger on Postgres must sustain 6,000 committed transfers/s at peak. Each transfer is one transaction. Estimate the commit throughput the WAL fsync allows (a) for one session committing serially, (b) with 64 concurrent sessions and group commit, on a cloud block volume vs a PLP enterprise NVMe. Is fsync the bottleneck?',
      assumptions: [
        'Cloud block volume (gp3/pd-ssd class): fdatasync ≈ 1 ms; PLP enterprise NVMe: fdatasync ≈ 50 µs',
        'Transaction CPU and execution time excluding fsync ≈ 0.5 ms per session',
        'Each transfer writes ~1 KB of WAL (two row updates + one insert + commit record)',
        'Group commit: a commit that arrives during a flush is covered by the next flush',
        '64 sessions from a pooler, all busy at peak',
      ],
      steps: [
        { label: 'Serial, cloud volume', calc: 'Per txn: 0.5 ms work + 1 ms fsync = 1.5 ms → 1 ÷ 1.5 ms ≈ 670 commits/s per session' },
        { label: 'Serial, PLP NVMe', calc: '0.5 ms + 0.05 ms = 0.55 ms → ≈ 1,800 commits/s per session' },
        { label: 'Without group commit (fsyncs serialize)', calc: 'Cloud: the device does ~1 ÷ 1 ms = 1,000 fsyncs/s → ≤ 1,000 commits/s total, far below 6,000' },
        { label: 'Group commit batch size, cloud', calc: 'While one 1 ms flush runs, the other 63 sessions finish 0.5 ms of work and queue → ~30–60 commits per flush' },
        { label: 'Group commit throughput, cloud', calc: '~1,000 flushes/s × ~30–60 commits ≈ 30K–60K commits/s ceiling from fsync; the session limit is 64 ÷ ~2 ms ≈ 32K/s' },
        { label: 'WAL bandwidth check', calc: '6,000/s × 1 KB ≈ 6 MB/s of WAL (+ full-page images after checkpoints, maybe ×3–5 → ~20–30 MB/s); well within a volume\'s 125–1,000 MB/s' },
        { label: 'Latency per commit', calc: 'Cloud: ≈ 0.5 ms work + wait for in-flight flush (≤ 1 ms) + own flush 1 ms ≈ 1.5–2.5 ms; NVMe PLP ≈ 0.6 ms' },
      ],
      answer:
        'One serial session tops out around 670 commits/s on cloud storage (≈1,800/s on PLP NVMe), and without group commit the device caps you near 1,000/s. With 64 concurrent sessions and group commit, the fsync ceiling rises to tens of thousands of commits/s. 6,000/s is comfortable, at ~2 ms commit latency on the cloud volume. fsync is the latency floor, not the throughput bottleneck, as long as there is concurrency.',
      insight:
        'Durable commit throughput is a concurrency problem: fsync latency bounds each session, and group commit converts concurrency into batch size. So the design levers are (1) enough concurrent sessions through a pooler, (2) no serial "one transfer at a time" worker, (3) a low-fsync-latency volume or PLP disk when per-request latency matters, and (4) hot-row locks, which serialize regardless of group commit and become the real limit before fsync does.',
      followUps: [
        {
          q: 'All 6,000 transfers/s debit the same merchant settlement account row. What changes?',
          a: 'The row lock is held from the UPDATE until COMMIT returns, which includes the fsync. Every transfer then pays ~0.5 ms of work plus ~1–2 ms of commit while holding that lock. They serialise at ~1 ÷ 2 ms ≈ 500/s no matter how good group commit is. Fixes: split the account into N sub-balance rows (shard the hot row), or append ledger entries and aggregate them asynchronously. On PLP NVMe the lock hold drops to ~0.6 ms, which raises the ceiling to ~1,600/s. Still not 6,000.',
        },
        {
          q: 'Finance agrees that "analytics events" may lose up to 1 s of data on power loss. How do you use that?',
          a: 'Run those inserts with SET LOCAL synchronous_commit = off. They return without waiting for the WAL flush, so latency drops to the ~0.5 ms of work. The WAL writer flushes them within ~3 × wal_writer_delay (≈600 ms), so possible loss is bounded below 1 s and there is no corruption. Money transfers keep synchronous_commit = on. Both kinds of write share the same fsyncs, so the transfers also benefit from the larger flushes.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-boe-2',
      question:
        'A notification service must hold 10,000 concurrent long-lived connections per instance. Estimate memory for (a) a thread-per-connection design on Linux with default 8 MB stacks (and Java with -Xss1m), vs (b) a Node event loop. Which limits do you hit first?',
      assumptions: [
        'Kernel stack per thread: 16 KB (x86-64)',
        'Touched user stack per blocked thread: ~32–64 KB (the reservation is 8 MB virtual, but only touched pages are resident)',
        'Per-thread runtime overhead (TLS, thread object, guard pages bookkeeping): ~8–16 KB',
        'Per-connection app state: ~4 KB in both designs; kernel socket structures ~2–4 KB idle (buffers autotune; idle ≈ small)',
        'Node baseline process ~60 MB RSS',
      ],
      steps: [
        { label: 'Virtual address space, threads', calc: '10K × 8 MB = 80 GB of stack reservations (fine on 64-bit, but counts against vm.max_map_count and overcommit=2 commit limits)' },
        { label: 'Resident per thread', calc: '16 KB kernel + ~48 KB touched user stack + ~12 KB overhead ≈ 76 KB' },
        { label: 'Resident, thread design', calc: '10K × 76 KB ≈ 760 MB + 10K × (4 KB app + 3 KB kernel socket) ≈ 70 MB → ≈ 0.8 GB' },
        { label: 'Java with -Xss1m', calc: 'Reservation 10K × 1 MB = 10 GB virtual; resident similar (~0.6–1 GB), plus JVM heap' },
        { label: 'Event loop design', calc: '60 MB base + 10K × (4 KB app + ~2 KB JS socket objects + 3 KB kernel) ≈ 60 + 90 MB ≈ 150 MB' },
        { label: 'Scale to 100K connections', calc: 'Threads ≈ 8 GB resident and 100K tasks for the scheduler; event loop ≈ 0.95 GB' },
      ],
      answer:
        'At 10K connections the thread design needs ~0.8 GB resident (and 80 GB virtual), the event loop ~150 MB, so it is about 5× better and both are feasible. At 100K the threads need ~8 GB plus raised limits, while the event loop needs under 1 GB. The first walls for threads are usually ulimit -u / threads-max / pid_max and RLIMIT_NOFILE, not RAM.',
      insight:
        'Memory is not why thread-per-connection fails at 10K; scheduling and limits are. The event loop\'s advantage grows with idle concurrency, so connection-heavy, low-CPU services (WebSockets, SSE, proxies) should be event-driven or use virtual threads/goroutines. CPU-heavy request work changes the answer, because there the event loop needs extra processes anyway.',
      followUps: [
        {
          q: 'During a broadcast every connection receives a 64 KB message at once and half the clients are on slow mobile networks. Redo the memory estimate for the Node design.',
          a: 'The kernel send buffers fill first: up to tcp_wmem autotuning, typically tens to hundreds of KB per socket. Then Node buffers the remainder in user space. Worst case 10K × 64 KB = 640 MB of extra buffering, kernel plus user, in a burst, and it repeats on every broadcast while slow clients have not drained. Without a writableLength cap and slow-consumer disconnects, a few broadcasts in a row push RSS past a 1 GB limit. Peak memory is set by the backlog, not by the connection count.',
        },
        {
          q: 'What changes with Java 21 virtual threads?',
          a: 'A virtual thread\'s stack lives on the heap as growable chunks of a few KB while it is parked, and blocking socket reads park it on an epoll-based poller instead of blocking an OS thread. 10K virtual threads cost roughly 10K × (2–10 KB) ≈ 20–100 MB, close to the event-loop numbers, while you keep blocking-style code. Watch for pinning: blocking while holding a synchronized lock pinned the carrier thread before JDK 24.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-boe-3',
      question:
        'A legacy thread-per-request service handles 20K requests/s on an 8-core box. Each request blocks twice (one DB call, one cache call), so its thread sleeps and wakes twice. Estimate the CPU spent on context switches, and compare it with an epoll event loop that batches ready sockets.',
      assumptions: [
        'Direct context-switch cost ≈ 3 µs; effective cost including cache/TLB warm-up ≈ 10 µs on cache-heavy code',
        'Each block → wake cycle costs 2 switches (switch out, later switch in); plus 2 more for request arrival and response = 6 switches per request',
        'Event loop: one epoll_wait returns on average 32 ready events at this load; ~1 µs per epoll_wait call; per-event syscalls (read/write) are needed in both designs',
        '8 cores = 8 CPU-seconds available per second',
      ],
      steps: [
        { label: 'Switches per second, threads', calc: '20K req/s × 6 switches = 120K switches/s' },
        { label: 'Direct CPU', calc: '120K × 3 µs = 0.36 CPU-s/s ≈ 4.5% of the 8 cores' },
        { label: 'Effective CPU with cache effects', calc: '120K × 10 µs = 1.2 CPU-s/s ≈ 15% of the box' },
        { label: 'Event loop wakeups', calc: 'Events: 20K × 3 (request, DB reply, cache reply) = 60K/s ÷ 32 per wait ≈ 1.9K epoll_wait/s' },
        { label: 'Event loop overhead', calc: '1.9K × 1 µs ≈ 2 ms CPU per second ≈ 0.03% of the box (plus the same read/write syscalls as threads)' },
        { label: 'At 4× load spike', calc: 'Threads: 480K switches/s × 10 µs = 4.8 CPU-s/s = 60% of the box just switching, and run-queue latency explodes' },
      ],
      answer:
        'At 20K req/s the thread design burns ~5% of the box directly and ~15% effectively on context switches. The event loop\'s wakeup cost is negligible (~0.03%) because one epoll_wait returns many ready sockets. Under a 4× spike the thread design spends most of its CPU switching.',
      insight:
        'Context switches are a tax that scales with blocking calls per request × RPS, and it bites hardest exactly at peak. Paths with many blocking hops (fan-out to several services) favour event loops or virtual threads. If you keep thread pools, keep them small (≈ cores × (1 + wait/compute)) so runnable threads ≈ cores, rather than hundreds of threads.',
      followUps: [
        {
          q: 'The service runs in a container with limits.cpu: 4 and 400 threads. What new effect appears on top of the switching cost?',
          a: 'CFS bandwidth throttling. 400 runnable threads can consume the 400 ms per 100 ms quota in ~1 ms of wall time when many are runnable at once. The whole cgroup then freezes until the next period. Requests see stalls of up to ~99 ms that look like random p99 spikes, while average CPU looks moderate. Shrinking the pool to ~2× cores, or using an event loop, keeps the number of runnable threads at about what the quota can serve.',
        },
        {
          q: 'How would you measure the real context-switch rate and cost on the box instead of assuming 10 µs?',
          a: 'Count with vmstat 1 (cs column), pidstat -w -t for per-thread voluntary vs involuntary switches, or perf stat -e context-switches,cpu-migrations -p PID. Estimate cost with perf sched record / perf sched latency, which shows wakeup-to-run delays, or run a microbenchmark that ping-pongs between two threads over a pipe. Comparing IPC (instructions per cycle) before and after cutting the thread count shows the cache-pollution part.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'fund-os-kernel-mcq-01',
      difficulty: 'hard',
      question:
        'A Redis primary with 12 GB of data runs BGSAVE every 15 minutes. The host has THP set to "always". During each save RSS climbs to ~23 GB even though only ~5% of keys are written while the child runs. What best explains the size of the spike?',
      options: [
        'The child process copies the whole 12 GB address space at fork time before it starts writing the RDB file',
        'Copy-on-write duplicates at huge-page granularity, so a few writes scattered across the keyspace copy 2 MB regions and duplicate most of the heap',
        'The RDB serializer buffers the entire snapshot in memory before writing it, so the child needs another 12 GB of heap',
        'The kernel page cache holding the RDB file being written counts as Redis RSS, so the file size is added to the process memory',
      ],
      correct: [1],
      explanation:
        'fork shares pages copy-on-write. With THP the unit of copy is a 2 MB huge page, so writes to 5% of keys spread across the heap touch most huge pages and duplicate nearly all 12 GB. fork does not copy data eagerly; it copies page tables. The RDB is streamed, not buffered whole. Page cache for the file is not process RSS (it can count against a cgroup, but that is not what RSS shows).',
      followUps: [
        {
          q: 'After disabling THP the spike drops to ~13 GB. Write traffic doubles next quarter. Roughly what do you expect?',
          a: 'With 4 KB pages, CoW memory scales with the number of distinct pages written during the save. Doubling the write rate roughly doubles the touched pages, so ~2 GB of duplication instead of ~1 GB, if keys are spread evenly. Hot keys on a few pages barely change it. Measure current_cow_size during saves, and keep headroom of dataset × (1 + worst CoW ratio) plus OS overhead.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-02',
      difficulty: 'expert',
      question:
        'A Node service runs with limits.cpu: 1 (cpu.max = 100000 100000). Logins call async crypto.scrypt, and the team set UV_THREADPOOL_SIZE=16 "to hash in parallel". During a login burst, health checks that normally take 2 ms intermittently take ~90 ms, while average pod CPU reads ~70%. What is happening?',
      options: [
        'The 16 pool threads plus the main thread consume the 100 ms quota early in each period, and the whole cgroup, main thread included, is frozen until the next period starts',
        'scrypt runs on the main thread when the pool is larger than the core count, so the event loop is blocked for the length of each hash',
        'Raising UV_THREADPOOL_SIZE makes libuv busy-poll epoll, which starves the health-check timer of wakeups',
        'Health checks are queued in the libuv thread pool behind the scrypt jobs because the HTTP parser runs on the pool',
      ],
      correct: [0],
      explanation:
        'CFS quota is per cgroup, summed across all threads. 16 busy pool threads burn 100 ms of CPU in ~6 ms of wall time, after which every thread, including the event loop, is throttled for the rest of the 100 ms period. That produces ~90 ms stalls with a moderate average. scrypt does not move to the main thread. libuv does not busy-poll. HTTP parsing runs on the main thread, not the pool.',
      followUps: [
        {
          q: 'Which two metrics would you put on the dashboard to prove this, and what is the fix?',
          a: 'Show nr_throttled / nr_periods (or throttled_usec) from cpu.stat next to event-loop delay p99. They spike together. Fix: size UV_THREADPOOL_SIZE to the quota (1–2 here), raise or remove the CPU limit, or scale out with more pods. Also put a concurrency limit on /login so bursts queue at the edge instead of inside the throttled cgroup.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-03',
      difficulty: 'hard',
      question:
        'A team implements a lock-free-ish counter shard with a user-space spinlock (an atomic compare-and-swap loop) shared via SharedArrayBuffer between 8 worker_threads, in a pod limited to 2 CPUs. Under load, throughput is far worse than with a simple Atomics.wait/notify-based mutex. Why?',
      options: [
        'Atomics compare-and-swap is not truly atomic across worker_threads, so the loop retries forever on torn writes',
        'Spinning only pays off when the lock holder is running; with 8 threads on a 2-CPU quota the holder is often descheduled or throttled, so waiters burn quota spinning while the holder cannot release',
        'SharedArrayBuffer memory is copied between isolates on every access, so each CAS costs a full message round trip',
        'Spinlocks always lose to mutexes because a mutex never makes a system call, even under contention',
      ],
      correct: [1],
      explanation:
        'A spinlock assumes the holder is running on another core and will release within nanoseconds. With more threads than CPUs, and CFS quota throttling on top, the holder is frequently not running, so spinners waste the quota and delay the holder further. Atomics are atomic across workers, and SharedArrayBuffer is truly shared, not copied. Mutexes do make futex syscalls under contention; they just sleep instead of burning CPU.',
      followUps: [
        {
          q: 'When would a spinlock be the right choice in a backend system?',
          a: 'When the critical section is shorter than a context switch (tens to hundreds of ns), the holder cannot sleep or be preempted while holding it, and there are no more threads than cores. Kernel code with preemption disabled and Postgres\'s tiny s_lock sections meet these conditions. In user space, prefer adaptive mutexes that spin briefly and then park.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-04',
      difficulty: 'expert',
      question:
        'A host runs with default vm.overcommit_memory = 0. Select ALL statements that are true about how memory exhaustion shows up for processes on it.',
      options: [
        'A large malloc() usually succeeds even if free RAM is low, because physical pages are only allocated when they are first touched',
        'When RAM runs out at page-fault time, the OOM killer sends SIGKILL to a victim chosen mainly by RSS and oom_score_adj, so the victim gets no chance to run cleanup code',
        'With overcommit 0, a process that exceeds free memory always receives ENOMEM from malloc, which runtimes such as V8 turn into a catchable exception',
        'Switching to vm.overcommit_memory = 2 makes allocations past the commit limit fail with ENOMEM, which lets a database fail one query instead of being killed',
        'Setting oom_score_adj = -1000 on a process removes its memory from the cgroup\'s memory.max accounting',
      ],
      correct: [0, 1, 3],
      explanation:
        'Under heuristic overcommit, allocations reserve address space and are backed lazily, so exhaustion is discovered at fault time and handled by the OOM killer with SIGKILL. Mode 2 enforces a commit limit, so malloc fails cleanly, which is why Postgres recommends it. Mode 0 rarely returns ENOMEM for plausible sizes. oom_score_adj only changes victim selection; it does not exempt memory from cgroup limits.',
      followUps: [
        {
          q: 'Why does Redis recommend overcommit_memory = 1 while Postgres recommends 2?',
          a: 'Redis forks for snapshots. In strict mode the child would need commit headroom for the whole parent heap, even though CoW will duplicate only a fraction, so fork can fail on a big instance. Mode 1 avoids that. Postgres prefers clean ENOMEM per query (mode 2), because an OOM SIGKILL of any backend forces the postmaster to restart every backend and run crash recovery.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-05',
      difficulty: 'hard',
      question:
        'A Postgres server with shared_buffers = 64 GB and 300 active backends shows ~15% of CPU in kernel page-fault and page-table code, and each backend\'s PageTables memory in /proc/meminfo adds up to tens of GB. What change addresses this most directly?',
      options: [
        'Enable huge_pages = on with pre-reserved hugetlbfs pages, so the shared buffer pool is mapped with 2 MB pages',
        'Increase work_mem so fewer sorts spill to disk and fewer pages are faulted in from temp files',
        'Set Transparent Huge Pages to "never" so that the kernel stops compacting memory in the background',
        'Lower checkpoint_timeout so dirty buffers are written out sooner and fewer pages need to stay mapped',
      ],
      correct: [0],
      explanation:
        'Every backend maps the 64 GB shared segment. With 4 KB pages each one builds page-table entries for the parts it touches (up to 128 MB per backend), and faults to populate them, while the TLB covers only a few MB. 2 MB huge pages shrink page tables ~512× and cut TLB misses. work_mem affects private memory and spills, not shared mappings. Disabling THP does not help a mapping that THP was not backing. Checkpoint frequency does not change how memory is mapped.',
      followUps: [
        {
          q: 'huge_pages = on fails at startup with "could not map anonymous shared memory". What do you check?',
          a: 'vm.nr_hugepages must reserve enough 2 MB pages for shared_buffers plus overhead. Postgres 15+ can report the exact number with postgres -C shared_memory_size_in_huge_pages. Also check that the reservation was not fragmented away after boot (set it at boot), and that the cgroup or container allows hugetlb. huge_pages = try would silently fall back to 4 KB pages, which is why "on" plus monitoring is safer.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-06',
      difficulty: 'hard',
      question:
        'This code calls an internal pricing API. Over a few hours, `ls /proc/PID/fd | wc -l` grows steadily, mostly sockets, and eventually requests fail with EMFILE. Which line is the leak?',
      code: {
        language: 'typescript',
        code: `import { request, Agent } from 'node:http';

const agent = new Agent({ keepAlive: true });

export function getPrice(sku: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'pricing.internal', path: '/p/' + sku, agent }, (res) => {
      if (res.statusCode === 404) return resolve(null);          // (A)
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body).price));    // (B)
    });
    req.on('error', reject);                                     // (C)
    req.setTimeout(500, () => req.destroy(new Error('timeout'))); // (D)
    req.end();
  });
}`,
      },
      options: [
        '(B) — JSON.parse runs on the event loop and holds the socket until parsing completes',
        '(C) — rejecting on error without calling req.destroy() leaves the socket open',
        '(A) — the 404 response body is never consumed, so the socket is never released back to the keep-alive agent or closed',
        '(D) — destroying the request on timeout leaves the fd in TIME_WAIT, which still counts as an open fd',
      ],
      correct: [2],
      explanation:
        'With keep-alive, a socket returns to the agent only after its response has been fully read. Resolving on 404 without res.resume() leaves the response paused, so the socket stays checked out and its fd stays open. Every 404 leaks one socket. JSON.parse is synchronous and finishes; it does not hold anything afterwards. A request that errors is already destroyed. TIME_WAIT sockets have no fd.',
      followUps: [
        {
          q: 'You add res.resume() for 404s, but the agent still opens hundreds of sockets during a slowdown. What else should you configure?',
          a: 'Set maxSockets on the agent (e.g. 50 per host) so concurrency is bounded and excess requests queue briefly instead of opening new sockets. Add a queue timeout or a bulkhead that fails fast, and set freeSocketTimeout / timeout so idle sockets close before the server\'s keep-alive timeout. Otherwise reused sockets can race with server-side closes and fail with ECONNRESET.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-07',
      difficulty: 'expert',
      question:
        'A custom TCP server built on raw epoll occasionally "freezes" individual connections: the client has sent a full request, but the server never responds and never reads again until the client sends more bytes. Based on this loop, what is the bug?',
      code: {
        language: 'text',
        code: `epoll_ctl(epfd, EPOLL_CTL_ADD, conn_fd, EPOLLIN | EPOLLET)

on_event(conn_fd):
    n = read(conn_fd, buf, 4096)        // read once per notification
    if n > 0:
        parser.feed(buf, n)
        while parser.has_request():
            handle(parser.next())
    else if n == 0:
        close(conn_fd)`,
      },
      options: [
        'EPOLLIN does not report data that arrived before the fd was added, so the first request is always lost',
        'The loop should call epoll_ctl(MOD) after every read; without that the fd is removed from the interest list',
        'With edge-triggered mode, a request larger than 4 KB leaves unread bytes and no new edge fires, so the handler must read until EAGAIN',
        'read() on a non-blocking socket can return n > 4096 when data is coalesced, overflowing buf and corrupting the parser',
      ],
      correct: [2],
      explanation:
        'EPOLLET signals only when new data arrives. If the request is more than 4 KB, one read leaves the rest in the receive buffer, no further edge occurs, and the connection waits until the client sends more. Edge-triggered handlers must drain until EAGAIN, or use level-triggered mode. epoll reports existing readiness on ADD. Without EPOLLONESHOT no re-arm is needed. read never returns more than the requested length.',
      followUps: [
        {
          q: 'You switch to draining until EAGAIN. One client streams megabytes continuously. What new problem appears, and how do you bound it?',
          a: 'One busy connection can monopolise the loop because the drain never hits EAGAIN, so every other fd starves. Cap the work per wakeup (e.g. read at most 64 KB, or N requests, per turn). In edge-triggered mode you must then remember that the fd still has data, for example on a ready list you revisit before calling epoll_wait again, because the kernel will not notify you again.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-08',
      difficulty: 'hard',
      question:
        'A Node service with the default UV_THREADPOOL_SIZE=4 is saturated by slow work. Select ALL operations whose latency will grow because they wait for a libuv pool thread.',
      options: [
        'fs.promises.readFile of a template on each request',
        'http.get("http://inventory.internal/...") resolving the hostname with the default lookup',
        'dns.promises.resolve4("inventory.internal")',
        'zlib.gzip of a 2 MB response body using the async API',
        'Reading request bodies from 10K keep-alive client sockets',
      ],
      correct: [0, 1, 3],
      explanation:
        'Async fs calls, dns.lookup (getaddrinfo, which http.get uses by default) and async zlib all run on the libuv pool, so they queue behind saturating work. dns.resolve4 uses c-ares and asynchronous UDP sockets on the main loop, without the pool. Socket reads are driven by epoll on the main thread. Pool saturation does not delay them directly, only a blocked main thread would.',
      followUps: [
        {
          q: 'Outbound calls are slow only because of DNS behind the pool. Name two fixes that do not raise the pool size.',
          a: 'Reuse connections with a keep-alive agent so most requests skip name resolution. Or pass a custom lookup function to the agent that uses dns.resolve4 (c-ares, off the pool) with a small TTL-respecting cache. Note that dns.resolve ignores /etc/hosts and nsswitch, so check that service discovery does not depend on them, as some Kubernetes setups with hostAliases do.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-09',
      difficulty: 'medium',
      question:
        'This probe runs in a NestJS pod. In production it logs p50 ≈ 11 ms, p99 ≈ 340 ms, max ≈ 1.2 s every few minutes, and ELU ≈ 0.35. What is the most reasonable conclusion?',
      code: {
        language: 'typescript',
        code: `import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
let last = performance.eventLoopUtilization();

setInterval(() => {
  const elu = performance.eventLoopUtilization(last);
  last = performance.eventLoopUtilization();
  console.log({
    p50: h.percentile(50) / 1e6,
    p99: h.percentile(99) / 1e6,
    max: h.max / 1e6,
    elu: elu.utilization,
  });
  h.reset();
}, 60_000);`,
      },
      options: [
        'The loop is saturated: ELU 0.35 means it is busy 65% of the time, so the pod needs more CPU',
        'The numbers point to libuv thread-pool saturation, because the pool delays timers until a thread is free',
        'p50 of 11 ms shows the timer resolution is wrong; the histogram reports microseconds, so real delays are 1,000× smaller',
        'The loop is mostly idle, but occasional long synchronous tasks block it for hundreds of ms; find them with a CPU profile around the spikes',
      ],
      correct: [3],
      explanation:
        'ELU 0.35 means the loop is busy 35% of the time, so there is plenty of headroom. But p99 at 340 ms and max at 1.2 s mean some individual callbacks run synchronously for hundreds of ms: big JSON serialisation, a sync crypto or regex call, or a large GC. The histogram reports nanoseconds, so dividing by 1e6 gives ms correctly. p50 near the 10 ms resolution is expected. Pool saturation delays pool work, not main-thread timers.',
      followUps: [
        {
          q: 'The max spikes line up with a nightly report endpoint. How would you confirm and fix it without guessing?',
          a: 'Take a CPU profile while the report runs: --cpu-prof, the inspector, or perf with --perf-basic-prof. You will likely see one long synchronous stack such as JSON.stringify of a huge array or a sort. Fix by streaming the result in chunks, moving the transform to a worker_thread, or paginating. Then verify that event-loop delay p99 drops while the report runs.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-10',
      difficulty: 'hard',
      question:
        'An API pod on :8080 is slow. You run the command below. How should you read the two ESTABLISHED lines?',
      code: {
        language: 'bash',
        code: `$ ss -tn state established '( sport = :8080 )'
Recv-Q   Send-Q   Local Address:Port   Peer Address:Port
412016   0        10.0.3.7:8080        10.0.1.20:51522
0        2598912  10.0.3.7:8080        10.0.9.41:40310`,
      },
      options: [
        'Both lines show packet loss on the network path; Recv-Q and Send-Q count retransmitted bytes',
        'Line 1: the peer is slow to read our responses; line 2: our process has not read 2.5 MB of request data',
        'Line 1 is an accept-queue overflow; line 2 shows the listen backlog limit for that connection',
        'Line 1: our process has not read ~400 KB the kernel already received (app not reading); line 2: ~2.5 MB we wrote is not yet acknowledged by that peer (slow client or network)',
      ],
      correct: [3],
      explanation:
        'For established sockets, Recv-Q is bytes received by the kernel but not yet read by the application, and Send-Q is bytes sent but not yet acknowledged by the peer. So line 1 points at our process (blocked loop, CPU starvation) and line 2 at a slow consumer or path. The option claiming the opposite swaps the two meanings. Accept-queue and backlog readings apply only to LISTEN sockets. The counters are not retransmission counts.',
      followUps: [
        {
          q: 'Line 2\'s client is a mobile app downloading a report. What happens to the Node process if the code ignores write() returning false?',
          a: 'Once the kernel send buffer is full, libuv keeps the remaining bytes in user-space memory, so socket.writableLength grows by everything the code keeps writing. For large exports to slow clients, RSS climbs until the pod is OOM-killed. Use pipeline() or wait for the \'drain\' event, and cap writableLength per connection.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-11',
      difficulty: 'expert',
      question:
        'Eight independent Node processes listen on :8080 with listen({ port: 8080, reusePort: true }). One of them hits a 2-second synchronous loop on a rare request. Compared with the same 8 workers under cluster round-robin, what happens to OTHER clients during those 2 seconds?',
      options: [
        'Nothing different: in both models the kernel notices the busy process and sends new connections elsewhere',
        'With reusePort, new connections the kernel hashes to the stuck process\'s listening socket wait in its accept queue for up to 2 s; with round-robin, the primary assigns connections to workers without knowing they are busy, so connections it hands to the stuck worker wait too, but the primary itself stays responsive',
        'With reusePort, the kernel retries the connection on another socket after the accept queue timeout, so clients only see a 200 ms delay',
        'With cluster round-robin, all workers stall, because the primary process blocks on IPC to the stuck worker',
      ],
      correct: [1],
      explanation:
        'SO_REUSEPORT picks a socket by hashing the 4-tuple and does not check whether its owner is busy, so roughly 1/8 of new connections queue behind the stuck process. Round-robin in the cluster primary is also unaware of load and still hands some connections to the stuck worker, but the primary keeps accepting and the other workers keep working. The kernel does not reroute queued connections. The cluster primary does not block on a busy worker.',
      followUps: [
        {
          q: 'Which existing keep-alive connections are affected in each model?',
          a: 'In both models, established keep-alive connections already owned by the stuck process wait for the whole 2 s, because each connection belongs to one process. That is often the larger blast radius. Shorter keep-alive, an L7 balancer with outlier ejection or least-request in front of the processes, and moving long CPU work off the loop limit it.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-12',
      difficulty: 'expert',
      question:
        'Select ALL statements that are true about accepting connections with multiple nginx workers on Linux.',
      options: [
        'Since nginx 1.11.3, accept_mutex defaults to off and nginx relies on EPOLLEXCLUSIVE (Linux 4.5+) to avoid waking every worker for each new connection',
        'Even with EPOLLEXCLUSIVE, workers sharing one listen socket are woken LIFO, so load tends to concentrate on the most recently idle workers',
        'With `listen ... reuseport`, each worker has its own accept queue, which balances by connection count but lets a blocked worker strand the connections hashed to it',
        'reuseport guarantees the lowest tail latency for CPU-heavy, variable-cost requests, because no connection waits in a shared queue',
        'With reuseport, nginx moves queued connections between workers automatically when one worker is slow',
      ],
      correct: [0, 1, 2],
      explanation:
        'nginx switched to EPOLLEXCLUSIVE, with accept_mutex off by default, in 1.11.3. Cloudflare showed that epoll wakeups are LIFO, which concentrates load. reuseport shards queues, which evens out load but creates per-worker head-of-line blocking, and Cloudflare measured a worse max latency with it for CPU-heavy requests. Plain reuseport cannot move queued connections; that needs eBPF steering or migration features.',
      followUps: [
        {
          q: 'Your workload is mostly sub-millisecond proxying with occasional 200 ms TLS renegotiation storms. Shared queue or reuseport?',
          a: 'Most requests are cheap and uniform, which favours reuseport: even CPU, no shared-queue contention, and better throughput, with NGINX showing 2–3× in its benchmark. Storms of expensive handshakes create per-queue blocking, though. I would benchmark p99.9 under a replayed storm. If the tail regresses, keep the shared queue for the TLS listener, or add more workers than cores to soften head-of-line blocking.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-13',
      difficulty: 'expert',
      question:
        'A service updates its state file with this function. After a power loss on an XFS volume, the file sometimes exists but is empty (0 bytes), although the function had returned. What is the minimal correct fix?',
      code: {
        language: 'typescript',
        code: `import { writeFile, rename } from 'node:fs/promises';

export async function saveState(path: string, state: object) {
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(state)); // resolves: data is "written"
  await rename(tmp, path);                      // atomic replace
}`,
      },
      options: [
        'Replace rename with copyFile, because rename is not atomic on XFS',
        'Open the temp file with O_DIRECT so the data bypasses the page cache and is durable when writeFile resolves',
        'fsync the temp file before rename, then fsync the parent directory after rename, so both the data and the new directory entry are durable',
        'Call fsync on the final path after rename; syncing the renamed file also persists the rename itself',
      ],
      correct: [2],
      explanation:
        'rename is atomic for the name, but the temp file\'s data may still be only in the page cache. After a crash the rename can be durable while the data blocks were never written, giving a zero-length file. fsync the data first, then fsync the directory to persist the new entry. copyFile is not atomic. O_DIRECT skips the page cache but not the device cache, and needs aligned buffers. Syncing the file after rename does not reliably persist the directory entry, and does not order the data before the rename.',
      followUps: [
        {
          q: 'This runs 2,000 times per second for small per-user state files. What does the fix cost, and how would you redesign it?',
          a: 'Two fsyncs per save (file plus directory) at ~1 ms each on cloud storage cap a serial writer at ~500 saves/s, and they add a lot of device flushes. Redesign: append changes to a single log with group-committed fdatasync, and compact it periodically into snapshots, as databases do. Or keep the state in a database or embedded KV store (SQLite in WAL mode, RocksDB) that already batches syncs.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-14',
      difficulty: 'expert',
      question:
        'On Linux, a WAL writer\'s fdatasync() returns EIO. The code logs a warning, sleeps, calls fdatasync() again on the same fd, and this time it returns 0. What can you conclude about the WAL bytes written before the first call?',
      options: [
        'They are durable: the second fdatasync succeeded, so the kernel rewrote the failed pages',
        'They are durable only if the filesystem is ext4, because ext4 keeps failed pages dirty until a later flush succeeds',
        'They are probably in the device\'s volatile cache, so issuing one more fdatasync will force them to media',
        'Nothing reliable: after a failed writeback the kernel may have marked those pages clean or dropped them, so the second call can succeed with the data lost; the safe action is to crash and recover from a known-good log',
      ],
      correct: [3],
      explanation:
        'This is fsyncgate. Linux reports a writeback error once, and may mark the failed pages clean or evict them. A later fsync has nothing dirty to flush and returns success. Neither ext4 nor XFS keeps the pages dirty for a retry. The error says nothing about where the data is, so assuming it sits in the device cache is unfounded. Postgres reacts by PANICking and replaying WAL.',
      followUps: [
        {
          q: 'Why does the PANIC-and-replay approach not lose the same data again on restart?',
          a: 'Recovery replays from WAL that was durably flushed before the failure, and treats anything after the last successful flush as never committed. Those clients never got a commit ack, so they retry. Writes that failed on data files are regenerated by redoing WAL records into the pages again. If the disk itself is failing, the restart fails, and you fail over to a replica rather than trusting the local device.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-15',
      difficulty: 'hard',
      question:
        'pg_test_fsync on a new developer-grade NVMe drive (no power-loss protection) reports ~45,000 fdatasync ops/s (~22 µs each), while the team\'s enterprise PLP NVMe shows ~30,000 ops/s. What is the most prudent interpretation?',
      options: [
        'The consumer drive is simply faster; PLP capacitors add latency to every flush',
        'fdatasync never reaches the device on NVMe, so both numbers only measure page-cache speed',
        'A non-PLP drive that "completes" flushes in ~22 µs is likely acknowledging from its volatile cache, so commits may not survive power loss; verify with a power-cut test before trusting it',
        'The difference comes from the filesystem block size, and remounting with 4 KB blocks will make both drives equal',
      ],
      correct: [2],
      explanation:
        'Without power-loss protection, a real flush must move data from DRAM to NAND, which typically takes hundreds of µs to ms. Tens of µs suggests the drive ignores or short-circuits flushes, which is the "SSD lies" scenario. PLP drives are fast because their cache is protected, not because flushing is free. fdatasync does reach the device. Block size does not explain an order-of-magnitude flush behaviour.',
      followUps: [
        {
          q: 'You must run on that consumer drive for a staging Postgres. How do you keep it honest, or accept the risk?',
          a: 'Check whether the drive reports a volatile write cache (nvme get-feature for the volatile write cache, or hdparm/smartctl), and that the kernel sends flushes (cat /sys/block/nvme0n1/queue/write_cache shows "write back"). If the drive lies even with flushes, disabling its write cache may restore honesty at a big latency cost. For staging, accepting loss on power failure is often fine. Document it, and never let production run on such hardware.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-16',
      difficulty: 'medium',
      question:
        'An events table receives 20K low-value inserts/s from many sessions, and commit latency (~2 ms on a cloud volume) dominates request time. The team proposes setting synchronous_commit = off just for those inserts. What is the accurate risk statement?',
      options: [
        'A crash can corrupt the database, because WAL records may be written out of order',
        'A power loss can lose the most recently acknowledged commits, bounded at roughly three times wal_writer_delay (~600 ms by default), but the database stays consistent',
        'There is no risk, because the data pages are still fsynced at the next checkpoint before the commit is acknowledged',
        'Other sessions\' synchronous commits also become asynchronous, so all transfers lose durability',
      ],
      correct: [1],
      explanation:
        'Asynchronous commit acknowledges before the WAL flush. A crash can lose the last fraction of a second of those commits, but WAL ordering is preserved, so there is no corruption, unlike fsync = off. Checkpoints do not run before acks. The setting can be scoped per session or per transaction with SET LOCAL, so synchronous transactions keep their guarantee.',
      followUps: [
        {
          q: 'Could group commit alone have fixed the latency without giving up durability?',
          a: 'It fixes throughput, not latency. With many concurrent sessions, one fsync already covers many commits, so 20K/s is easily sustainable. But every commit still waits for at least one flush, about 1–2 ms on this volume. If the problem is per-request latency rather than throughput, the options are faster storage (PLP NVMe), async commit for low-value writes, or batching inserts per request.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-17',
      difficulty: 'expert',
      question:
        'A storage engineer proposes opening data files with O_DIRECT. Select ALL statements that are correct.',
      options: [
        'O_DIRECT transfers data between the user buffer and the device without passing through the page cache',
        'O_DIRECT alone guarantees durability on power loss, so fsync calls can be removed',
        'O_DIRECT I/O usually requires buffers, offsets and lengths aligned to the logical block size',
        'With O_DIRECT the application loses kernel read-ahead and caching, so it needs its own buffer pool to perform well',
        'O_DIRECT makes concurrent writes to the same block atomic across processes',
      ],
      correct: [0, 2, 3],
      explanation:
        'O_DIRECT bypasses the page cache through DMA from aligned buffers. That is why engines such as InnoDB pair it with their own buffer pool, and the kernel no longer reads ahead or caches for them. Data can still sit in the device\'s volatile cache, so durability still needs fsync/fdatasync or O_DSYNC. O_DIRECT gives no atomicity guarantees between concurrent writers.',
      followUps: [
        {
          q: 'Postgres mostly uses buffered I/O for data files. Why, and what changed recently?',
          a: 'Historically Postgres relied on the OS page cache as a second cache layer, plus kernel read-ahead and writeback, which kept the code portable and simple. The costs are double buffering, fsyncgate exposure and less control. Postgres 18 added an asynchronous I/O subsystem (worker or io_uring methods) for reads, and direct I/O remains a developer option for now. A move toward direct I/O needs that AIO work, otherwise performance drops without read-ahead.',
        },
      ],
    },
    {
      id: 'fund-os-kernel-mcq-18',
      difficulty: 'medium',
      question:
        'A Node service runs in a pod with limits.cpu: 2 on a 64-core node and starts this way. Pods are slow and memory-hungry right after deploys. What is the primary problem?',
      code: {
        language: 'typescript',
        code: `import cluster from 'node:cluster';
import { cpus } from 'node:os';
import { bootstrap } from './main';

if (cluster.isPrimary) {
  const n = cpus().length;
  for (let i = 0; i < n; i++) cluster.fork();
} else {
  void bootstrap(); // NestJS app.listen(3000)
}`,
      },
      options: [
        'os.cpus() reports the host\'s 64 cores, not the 2-CPU quota, so 64 workers (each with its own heap and helper threads) compete for 200 ms of CPU per 100 ms period',
        'cluster workers cannot share port 3000, so 63 of them crash-loop with EADDRINUSE',
        'The primary accepts connections with SCHED_NONE by default, so all traffic goes to two workers',
        'NestJS cannot run under cluster because its dependency-injection container is shared across processes',
      ],
      correct: [0],
      explanation:
        'Containers do not hide host cores from os.cpus(), so the code forks 64 workers into a 2-CPU quota. Each one is a full V8 process with ~50–100 MB of heap, plus GC and libuv threads, and they all throttle each other. In cluster mode workers do share the port through the primary. The default policy is round-robin on Linux, not SCHED_NONE. NestJS runs fine per worker, since each process has its own container.',
      followUps: [
        {
          q: 'What would you ship instead, and how many workers per pod?',
          a: 'One process per pod with requests.cpu around 1, letting the HPA add replicas. Metrics, OOM kills and readiness then map cleanly to a single process. If an architectural reason requires several workers per pod, derive the count from /sys/fs/cgroup/cpu.max (quota ÷ period, here 2), not from os.cpus(), and set UV_THREADPOOL_SIZE small so helper threads do not overrun the quota.',
        },
      ],
    },
  ],
};

export default topic;
