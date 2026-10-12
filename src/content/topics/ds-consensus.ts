import type { Topic } from '../../types';

const topic: Topic = {
  id: 'ds-consensus',
  phase: 'distributed',
  order: 2,
  title: 'Consensus, Leader Election & Time',
  subtitle:
    'How machines agree when networks lie and clocks drift: Raft in detail, Paxos intuition, etcd/ZooKeeper in practice, leases with fencing tokens, failure detectors, split brain, NTP vs TrueTime, and Lamport/vector/hybrid logical clocks.',
  estimatedMinutes: 95,
  sources: [
    'Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, 2014)',
    'Leslie Lamport — Paxos Made Simple (2001); Time, Clocks, and the Ordering of Events (1978)',
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 8 & 9; "How to do distributed locking" (2016)',
    'Alex Xu — System Design Interview Vol 2, Ch 12 (Digital Wallet — Raft) & Ch 13 (Stock Exchange)',
    'Corbett et al. — Spanner (TrueTime, 2012); Kulkarni et al. — Hybrid Logical Clocks (2014)',
    'etcd and ZooKeeper documentation',
  ],
  tags: ['consensus', 'raft', 'paxos', 'etcd', 'zookeeper', 'leader-election', 'fencing-token', 'failure-detection', 'split-brain', 'clocks', 'lamport', 'vector-clock', 'hlc'],
  cheatSheet: [
    'Consensus = a group agrees on one value/sequence despite crashes: needs a majority quorum of 2f+1 nodes to tolerate f failures (3 → 1, 5 → 2). Even sizes add cost, not tolerance.',
    'Raft: one leader per term. Election: follower times out (randomised, e.g. 150–300 ms paper, 1 s etcd default), increments term, RequestVote; a node votes once per term and only for candidates whose log is at least as up to date.',
    'Raft replication: leader appends, sends AppendEntries (prevLogIndex/prevLogTerm consistency check); an entry is committed once stored on a majority AND from the leader\'s current term; then applied to the state machine.',
    'Higher term always wins: any node seeing a higher term steps down to follower. Stale leaders are harmless for writes (can\'t get a majority) but can serve stale reads unless using ReadIndex or lease reads.',
    'Paxos = prepare/promise then accept/accepted with ballot numbers; Multi-Paxos with a stable leader ≈ Raft. ZooKeeper uses ZAB; etcd/Consul use Raft.',
    'Use etcd/ZooKeeper for small, critical coordination data: leader election, locks, config, membership, service discovery — not for bulk data (etcd default size limit 2 GB, request limit 1.5 MB).',
    'Leases expire while a paused process still believes it holds them. Always pair leases/locks with a monotonically increasing FENCING TOKEN that the protected resource checks.',
    'Failure detection is guesswork: heartbeats + timeouts. Phi accrual (Cassandra, Akka; threshold ≈ 8) adapts to observed jitter. Too-short timeouts → leader flapping; too long → slow failover.',
    'Wall clocks drift and jump (NTP steps, leap seconds, VM pauses). Never order events across machines by wall time; use monotonic clocks for durations. TrueTime bounds uncertainty ε and waits it out.',
    'Lamport clock: total order consistent with causality (not the reverse). Vector clock: detects concurrency. HLC: physical-time-like 64-bit timestamps that respect causality (CockroachDB, MongoDB, YugabyteDB).',
  ],
  sections: [
    {
      heading: 'Why consensus — and why it is hard',
      body: `**Intuition:** five friends choosing a restaurant by text message, where messages can be delayed or lost and anyone can fall asleep mid-conversation. They must never end up at two different restaurants, and they should eventually decide something as long as most of them are awake.

**Consensus properties:** *agreement* (no two nodes decide differently), *validity* (the decided value was proposed by someone), *termination* (non-faulty nodes eventually decide). In practice systems use consensus to agree on a **replicated log** — a sequence of commands — which gives you a replicated state machine (every node applies the same commands in the same order).

**What you build on it:**
- **Leader election** — exactly one scheduler, one primary DB (Patroni), one Kafka controller (KRaft).
- **Linearizable storage** of small critical data — config, feature flags, cluster membership, locks (etcd for Kubernetes, ZooKeeper for older Kafka/HBase).
- **Atomic commit of replicated data** — CockroachDB/TiKV/Spanner run one consensus group per data range; Alex Xu's digital wallet (Vol 2 Ch 12) uses Raft to replicate the event log.

**Why it's hard:**
- **FLP impossibility (1985):** in a fully asynchronous system with even one crash-faulty process, no deterministic algorithm can guarantee consensus terminates. Real protocols guarantee *safety always* and *liveness* only when the network is "timely enough" (timeouts, randomisation).
- You can't distinguish a **slow** node from a **dead** one.
- Nodes can **pause** (GC, VM migration) and wake up believing stale things.

**Quorum math:** with **2f + 1** nodes you tolerate **f** crash failures, because any two majorities intersect. 3 nodes → 1 failure, 5 → 2, 7 → 3. A 4-node cluster still tolerates only 1 failure (majority = 3) but has more nodes to fail and more acks to wait for. These algorithms assume *crash* faults, not malicious (Byzantine) ones — BFT needs 3f + 1 nodes and is used in blockchains, rarely in backends.`,
      diagram: `Majority quorums always intersect (5 nodes, majority = 3)

   write quorum:  [ N1  N2  N3 ]  N4   N5
   next leader's
   vote quorum:     N1  N2 [ N3   N4   N5 ]
                            ▲
                 at least one node (N3) has seen the committed entry,
                 so no new leader can be elected without it`,
      keyPoints: [
        'Consensus underpins leader election, config/locks, and replicated logs.',
        'Safety is always guaranteed; liveness only with timely-enough networks (FLP).',
        '2f+1 nodes tolerate f failures; prefer odd cluster sizes (3 or 5).',
      ],
    },
    {
      heading: 'Raft leader election: terms, votes and randomised timeouts',
      body: `**Intuition:** time is divided into numbered *terms*, like presidential terms. Each term has at most one leader. If followers stop hearing from the leader, one of them calls an election for the next term and asks for votes.

**Roles:** *follower* (passive, responds to RPCs), *candidate* (running for election), *leader* (handles all client writes, sends heartbeats).

**Election, step by step:**
1. A follower hears no AppendEntries/heartbeat within its **election timeout** (randomised; the paper suggests 150–300 ms; etcd defaults to heartbeat 100 ms, election timeout 1,000 ms).
2. It increments \`currentTerm\`, becomes candidate, **votes for itself**, persists term + vote to disk, and sends \`RequestVote(term, candidateId, lastLogIndex, lastLogTerm)\` to all.
3. A node grants its vote if: the term is ≥ its own, it hasn't voted for someone else **in this term**, and the candidate's log is **at least as up to date** (higher last term, or same last term and ≥ last index). This *election restriction* guarantees the new leader already has every committed entry.
4. With votes from a **majority**, the candidate becomes leader and immediately sends heartbeats (and appends a no-op entry to commit something from its own term).
5. If it receives an AppendEntries from a leader with term ≥ its own, it steps down. If the election times out (split vote), it starts a new term — **randomised timeouts** make repeated split votes unlikely.

**Rule that fixes most bugs:** any RPC request or response carrying a **higher term** makes the receiver update its term and revert to follower.

**Production extensions:** **PreVote** (a candidate first checks it *could* win before incrementing the term — prevents a partitioned node from disrupting the cluster when it rejoins with a huge term) and **CheckQuorum** (a leader that can't reach a majority for an election timeout steps down). Both are enabled in etcd.`,
      diagram: `   N1 (follower)        N2 (follower)        N3 (follower, leader died)
       │                    │                    │
       │  election timeout (randomised) fires on N2
       │                    │ term=5, vote self
       │◀── RequestVote(t5, lastIdx=42, lastTerm=4) ──┤──────────▶│
       │                    │                    │
       │ log ok, not voted  │                    │ (down)
       ├── VoteGranted(t5) ─▶│                    │
       │                    │ 2/3 votes = majority → LEADER of term 5
       │◀── AppendEntries(t5, heartbeat + no-op) ─┤
       │ reset timer        │
       │                    │
   N3 recovers with term 4 → receives AppendEntries(t5) → steps down, follows N2`,
      code: [
        {
          language: 'typescript',
          title: 'RequestVote handling with the election restriction and term rules',
          code: `interface LogEntry { term: number; command: unknown }
interface VoteReq { term: number; candidateId: string; lastLogIndex: number; lastLogTerm: number }
interface VoteRes { term: number; voteGranted: boolean }

export class RaftNode {
  currentTerm = 0;                 // persisted
  votedFor: string | null = null;  // persisted
  log: LogEntry[] = [];            // persisted; log[0] is index 1
  role: 'follower' | 'candidate' | 'leader' = 'follower';
  private electionTimer?: NodeJS.Timeout;

  constructor(private persist: (s: { term: number; votedFor: string | null }) => Promise<void>) {}

  async onRequestVote(req: VoteReq): Promise<VoteRes> {
    if (req.term > this.currentTerm) this.stepDown(req.term);   // higher term always wins
    if (req.term < this.currentTerm) return { term: this.currentTerm, voteGranted: false };

    const myLastTerm = this.log.at(-1)?.term ?? 0;
    const myLastIndex = this.log.length;
    // Election restriction: candidate's log must be at least as up to date as ours
    const upToDate = req.lastLogTerm > myLastTerm ||
      (req.lastLogTerm === myLastTerm && req.lastLogIndex >= myLastIndex);
    const canVote = this.votedFor === null || this.votedFor === req.candidateId;

    if (canVote && upToDate) {
      this.votedFor = req.candidateId;
      await this.persist({ term: this.currentTerm, votedFor: this.votedFor }); // BEFORE replying
      this.resetElectionTimer();   // granting a vote defers our own candidacy
      return { term: this.currentTerm, voteGranted: true };
    }
    return { term: this.currentTerm, voteGranted: false };
  }

  stepDown(term: number): void {
    this.currentTerm = term;
    this.votedFor = null;           // new term => may vote again
    this.role = 'follower';
  }

  resetElectionTimer(): void {
    clearTimeout(this.electionTimer);
    const timeout = 150 + Math.random() * 150; // randomised 150–300 ms avoids split votes
    this.electionTimer = setTimeout(() => this.startElection(), timeout);
  }

  startElection(): void { /* term++, vote self, persist, send RequestVote to peers... */ }
}`,
        },
      ],
      keyPoints: [
        'One leader per term; votes are persisted and granted once per term.',
        'Election restriction ensures a new leader has all committed entries.',
        'Randomised timeouts, PreVote and CheckQuorum keep elections stable in production.',
      ],
      source: 'Raft paper §5.2, §5.4.1',
    },
    {
      heading: 'Raft log replication, commit index and safety',
      body: `**Intuition:** the leader is the single author of a shared notebook. It writes a line, asks followers to copy it, and once most have copied it, the line is permanent ("committed") and everyone can act on it.

**AppendEntries(term, leaderId, prevLogIndex, prevLogTerm, entries[], leaderCommit):**
1. Client sends a command to the leader; the leader appends it to its log (index i, current term).
2. Leader sends AppendEntries to followers in parallel. Each follower checks that its log contains an entry at **prevLogIndex with prevLogTerm** (the *log matching* check). If not, it rejects; the leader decrements \`nextIndex\` for that follower and retries (with an optimisation to skip back a whole term), overwriting conflicting uncommitted entries on the follower.
3. When the entry is stored on a **majority** (leader included) **and** belongs to the leader's **current term**, the leader advances \`commitIndex\`. Earlier-term entries become committed indirectly when a current-term entry after them commits (the famous *Figure 8* rule — counting replicas of an old-term entry is unsafe).
4. The leader applies committed entries to its state machine, replies to the client, and tells followers the new \`leaderCommit\` in the next AppendEntries; followers apply up to it.

**Safety properties:** *Election safety* (≤ 1 leader per term), *leader append-only*, *log matching* (same index + term ⇒ identical prefix), *leader completeness* (committed entries appear in all future leaders' logs), *state machine safety* (no two nodes apply different commands at the same index).

**Linearizable reads:** a leader might be deposed without knowing it. Options: route reads through the log (slow), **ReadIndex** (leader records commitIndex, confirms leadership with a heartbeat round to a majority, waits until applied ≥ that index — etcd's default), or **lease reads** (skip the round if a leader lease is valid — depends on bounded clock drift).

**Other mechanics:** **snapshots** + log compaction (InstallSnapshot for lagging followers); **membership changes** via joint consensus or one-server-at-a-time changes; **learners** (non-voting members) to catch up a new node before it votes.

**Performance:** every commit needs a disk fsync on a majority plus one RTT. With NVMe (fsync ≈ 0.1–1 ms) and in-region RTT ≈ 1 ms, commits take ~2–5 ms; batching and pipelining give tens of thousands of writes/s per group — but it is *one leader per group*, so systems like CockroachDB/TiKV run thousands of Raft groups (one per range) to scale.`,
      diagram: `Leader (term 3)  log: [1:t1][2:t1][3:t2][4:t3][5:t3]   commitIndex=4
Follower A       log: [1:t1][2:t1][3:t2][4:t3][5:t3]   matchIndex=5
Follower B       log: [1:t1][2:t1][3:t2][4:t3]         matchIndex=4
Follower C       log: [1:t1][2:t1][3:t2]  (lagging)    matchIndex=3
Follower D       log: [1:t1][2:t1][3:t2][4:t2]  ✗ conflicting uncommitted entry

majority (3 of 5) has index 5? leader + A only → no
                     index 4? leader, A, B   → yes
→ commitIndex = 4 (term 3 = current term ✓)
D: AppendEntries(prevLogIndex=3, prevLogTerm=t2, entries=[4:t3, 5:t3])
   → D truncates its [4:t2] and appends the leader's entries`,
      code: [
        {
          language: 'typescript',
          title: 'Leader: advance commitIndex only for current-term entries on a majority',
          code: `interface Peer { id: string; matchIndex: number } // highest index known replicated

export function advanceCommitIndex(
  log: { term: number }[],     // log[i-1] is entry at index i
  currentTerm: number,
  commitIndex: number,
  leaderLastIndex: number,
  peers: Peer[],
): number {
  const clusterSize = peers.length + 1;               // + leader
  const majority = Math.floor(clusterSize / 2) + 1;

  for (let n = leaderLastIndex; n > commitIndex; n--) {
    // Figure 8 rule: never commit an old-term entry by counting replicas
    if (log[n - 1].term !== currentTerm) break; // earlier entries: older terms, stop
    const replicas = 1 + peers.filter((p) => p.matchIndex >= n).length;
    if (replicas >= majority) return n;          // commits n and every entry before it
  }
  return commitIndex;
}

// Example: 5 nodes, current term 3
// log terms by index: [1,1,2,3,3], matchIndex: A=5, B=4, C=3, D=2
// advanceCommitIndex(...) === 4  (leader, A, B hold index 4; only leader+A hold 5)`,
        },
      ],
      keyPoints: [
        'Log matching check + overwriting conflicts keeps follower logs identical to the leader\'s.',
        'Commit = majority replicated AND current term; older entries commit indirectly.',
        'Linearizable reads need ReadIndex or leases, not just "ask the leader".',
      ],
      source: 'Raft paper §5.3, §5.4, §8; etcd docs',
    },
    {
      heading: 'Paxos intuition and how the protocols compare',
      body: `**Intuition:** Paxos is an auction with numbered bids. A proposer first asks acceptors to *promise* to ignore lower bids; then asks them to *accept* a value. If some acceptor already accepted a value, the proposer must re-propose **that** value — so once a majority accepts something, it can never be changed.

**Single-decree Paxos (Lamport):**
1. **Prepare(n)** — proposer picks a unique, increasing ballot n and sends it to acceptors.
2. **Promise(n, accepted?)** — an acceptor promises never to accept ballots < n and returns the highest-numbered proposal it has already accepted (if any).
3. **Accept(n, v)** — with promises from a majority, the proposer sends v = the value of the highest accepted proposal among the promises, or its own value if none.
4. **Accepted** — acceptors accept unless they've promised a higher ballot. A value accepted by a majority is **chosen**.

Two proposers can duel forever (livelock) with ever-higher ballots — hence a **distinguished leader** in practice. **Multi-Paxos**: elect a stable leader that runs phase 1 once, then only phase 2 per log slot — structurally very close to Raft.

| | Raft | Multi-Paxos | ZAB (ZooKeeper) |
|---|---|---|---|
| Design goal | Understandability | Minimal assumptions, many variants | Primary-backup order for ZooKeeper |
| Leader | Strong; only leader appends | Usually a stable leader (optimisation) | Strong leader |
| Log holes | Not allowed | Allowed (slots decided independently) | Not allowed |
| Leader must have all committed entries | Yes (election restriction) | No — new leader recovers via phase 1 | Yes (sync phase) |
| Used by | etcd, Consul, CockroachDB, TiKV, Kafka KRaft, MongoDB (Raft-like) | Spanner, Chubby, Megastore | ZooKeeper |
| Lightweight transactions | — | Cassandra LWT uses single-decree Paxos per partition | — |

**In interviews:** you're rarely asked to derive Paxos. Show you understand *why* majority intersection + ballot/term ordering makes a chosen value stable, and that Raft is essentially Multi-Paxos with a stronger leader and stricter log rules.`,
      keyPoints: [
        'Paxos: prepare/promise locks out older ballots; accept must reuse any previously accepted value.',
        'Multi-Paxos with a stable leader ≈ Raft; dueling proposers cause livelock.',
        'Cassandra LWTs use per-partition Paxos (~4 round trips).',
      ],
      source: 'Lamport — Paxos Made Simple (2001)',
    },
    {
      heading: 'Using etcd and ZooKeeper in practice',
      body: `**Intuition:** you almost never implement consensus yourself — you rent it. etcd and ZooKeeper are small, strongly consistent, highly available stores designed for *coordination*, not for application data.

**Good uses:** leader election, distributed locks (with fencing), service discovery/membership, dynamic config and feature flags, shard maps (e.g. the versioned slot map in *db-sharding*), distributed barriers.

**Primitives you build with:**

| Need | etcd | ZooKeeper |
|---|---|---|
| Liveness-bound ownership | **Lease** with TTL, kept alive by the client; keys attached to it vanish on expiry | **Ephemeral znode**, deleted when the session expires |
| Ordering / queue position | Key **create revision** (global, monotonically increasing) | **Sequential znode** suffix |
| Change notification | **Watch** from a revision (no missed events) | **Watch** (one-shot, re-register) |
| Atomic check-and-set | **Txn**: if (compare) then (ops) else (ops) | \`setData\` with expected version, multi-op |
| Fencing token | Key \`mod_revision\` / \`create_revision\` | znode \`zxid\` / version |

**Election recipe (ZooKeeper):** every candidate creates an ephemeral sequential node under \`/election\`; the lowest sequence is leader; each other node watches **only its predecessor** (avoids the herd effect of everyone watching the leader). etcd's \`concurrency.Election\` does the same with leases and revisions.

**Operational numbers & limits:**
- 3 or 5 members (5 tolerates 2 failures; 7+ slows writes). Put them in 3 AZs.
- etcd is **disk-latency sensitive**: every write is fsynced; keep WAL fsync p99 < 10 ms (etcd docs recommend SSDs). Slow disks → leader elections → Kubernetes API outages.
- etcd defaults: 2 GB backend quota (configurable up to 8 GB recommended max), 1.5 MB max request size. Compact and defragment regularly.
- Throughput: order of **10K+ writes/s** on good hardware for small keys — plenty for coordination, nowhere near a database.

**Anti-patterns:** storing large blobs or per-request data; watching huge prefixes from thousands of clients; using a lock without fencing to protect a non-idempotent side effect.`,
      code: [
        {
          language: 'typescript',
          title: 'Leader election on etcd with a lease and a fencing token (etcd3 client)',
          code: `import { Etcd3 } from 'etcd3';

const etcd = new Etcd3({ hosts: ['http://etcd-0:2379', 'http://etcd-1:2379', 'http://etcd-2:2379'] });
const KEY = '/leaders/billing-scheduler';

export async function runForLeader(podName: string, work: (token: string) => Promise<void>) {
  const lease = etcd.lease(10);                   // TTL 10 s, auto keep-alive every ~TTL/3
  const leaseId = await lease.grant();
  lease.on('lost', () => process.exit(1));        // lost lease => we are NOT leader: stop hard

  for (;;) {
    // Atomically create the key only if nobody holds it
    const res = await etcd
      .if(KEY, 'Create', '==', 0)
      .then(etcd.put(KEY).value(podName).lease(leaseId))
      .commit();

    if (res.succeeded) {
      // The revision of this put is globally monotonic -> perfect fencing token
      const fencingToken = res.header.revision;
      await work(fencingToken);                   // pass token to every protected write
      return;
    }
    // Someone else leads: wait until the key is deleted (lease expired / resigned)
    const watcher = await etcd.watch().key(KEY).create();
    await new Promise<void>((resolve) => watcher.on('delete', () => resolve()));
    await watcher.cancel();
  }
}`,
        },
      ],
      keyPoints: [
        'Rent consensus: etcd/ZooKeeper for small, critical coordination state.',
        'Leases/ephemeral nodes bind ownership to liveness; revisions give fencing tokens.',
        'etcd is fsync-bound: fast disks, 3–5 members across AZs, compaction.',
      ],
      source: 'etcd docs — Tuning, Hardware; ZooKeeper Recipes',
    },
    {
      heading: 'Leases and fencing tokens: making leader election actually safe',
      body: `**Intuition:** a lease is a parking permit with an expiry time. The problem: the driver might fall asleep in the car (a GC pause), wake up after the permit expired, and still think they're allowed to park — while someone else now holds a valid permit.

**The failure (Kleppmann's canonical example):**
1. Client 1 acquires a lock/lease (TTL 10 s) and starts writing a file.
2. Client 1 pauses for 15 s (stop-the-world GC, VM live migration, SIGSTOP, disk stall, network delay of its request).
3. The lease expires; client 2 acquires it and writes.
4. Client 1 resumes, still believing it holds the lease, and writes too → **corruption**. Checking "do I still hold the lease?" just before writing doesn't help: the pause can happen between the check and the write, and the write itself can be delayed in the network.

**The fix — fencing tokens:** every time the lock is granted, the lock service returns a **monotonically increasing token** (etcd revision, ZooKeeper zxid, a DB sequence). Every write to the protected resource carries the token, and **the resource rejects any token lower than the highest it has seen**. Client 1's delayed write carries token 33; the storage has already seen 34 from client 2 → rejected.

**Implications:**
- The *resource* must participate (a DB conditional update, an object store with preconditions, a service that tracks the max token). If the resource can't check tokens, make the operation **idempotent** or design around it.
- **Redis-based locks** (single-instance SET NX PX, or Redlock across 5 instances) don't produce fencing tokens and rely on bounded clock drift and pauses; fine for **efficiency** locks (avoid duplicate work), not for **correctness** locks (preventing corruption). Use etcd/ZooKeeper/a DB for those.
- Leader-based systems apply the same idea: **Raft terms** and **Kafka controller epochs / leader epochs** are fencing tokens; brokers reject requests from a stale controller epoch.

**Lease tuning:** TTL must exceed worst-case renewal latency plus pauses (e.g. 10–30 s), renewal every TTL/3. Shorter TTL = faster failover but more false expirations under GC or network jitter.`,
      diagram: `Lock svc          Client 1              Client 2        Storage (max_token)
   │─ token 33 ─▶│                                              0
   │             │── write(token 33) ──────────────────────────▶ 33 ✓
   │             │ ░░ GC pause 15 s ░░
   │ lease expires
   │─ token 34 ──┼────────────────────▶│
   │             │                     │── write(token 34) ────▶ 34 ✓
   │             │ wakes up:
   │             │── write(token 33) ─────────────────▶ 33 < 34 ✗ REJECTED`,
      code: [
        {
          language: 'sql',
          title: 'The protected resource enforces the fencing token',
          code: `-- Each protected resource remembers the highest token it has accepted
CREATE TABLE job_state (
  job_id        text PRIMARY KEY,
  owner         text,
  fencing_token bigint NOT NULL DEFAULT 0,
  payload       jsonb
);

-- Every write by a (possibly stale) leader carries its token.
-- The row is updated only if the token is >= the highest seen so far.
UPDATE job_state
SET    payload = $3,
       owner = $4,
       fencing_token = $2
WHERE  job_id = $1
  AND  fencing_token <= $2;     -- stale leader (lower token) => 0 rows updated

-- Application: if rowCount = 0 then we have been fenced -> stop acting as leader.`,
        },
      ],
      keyPoints: [
        'Leases alone are unsafe: pauses and delayed messages outlive them.',
        'Fencing tokens must be monotonic and checked by the resource itself.',
        'Redis/Redlock locks are for efficiency, not correctness; terms and epochs are fencing tokens.',
      ],
      source: 'Kleppmann — DDIA Ch 8; "How to do distributed locking" (2016)',
    },
    {
      heading: 'Failure detectors: heartbeats, timeouts and phi accrual',
      body: `**Intuition:** you can't know a node is dead — only that you haven't heard from it for a while. A failure detector is a policy for how suspicious to be.

**Heartbeats + fixed timeout:** nodes send heartbeats every *h* ms; if none arrive for *T* ms, declare failure. The trade-off:
- **Short T** → fast failover but **false positives** during GC pauses, network jitter or CPU saturation → unnecessary leader elections, **flapping**, and thundering-herd recoveries.
- **Long T** → fewer false positives but longer unavailability after a real failure.
Rule of thumb: T ≥ several heartbeat intervals and > p99.9 of observed pause/jitter. etcd's default ratio is 1:10 (100 ms heartbeat, 1 s election timeout) and it recommends election timeout ≥ 5–10× RTT.

**Phi accrual failure detector** (Hayashibara et al., used in Cassandra and Akka): instead of a boolean, output a suspicion level φ based on the *statistical distribution* of recent heartbeat inter-arrival times. φ = −log10(P(a heartbeat arrives later than now)). φ = 1 → ~10% chance of false positive, φ = 8 (Cassandra's default \`phi_convict_threshold\`) → ~10⁻⁸ under the model. It adapts automatically to noisy networks (e.g. cloud or cross-region) — raise the threshold to 10–12 on jittery infrastructure.

**Gossip-based detection (SWIM, used by Consul/Serf, memberlist):** nodes ping random peers; if no ack, ask k others to ping indirectly before suspecting; suspicion is disseminated by gossip and a node can refute it. Scales to thousands of nodes with constant per-node load.

**Protect against flapping:** PreVote and CheckQuorum in Raft, hysteresis (require several missed heartbeats), exponential backoff on repeated elections, and — critically — make leader *failover* safe with fencing so false positives cost only latency, not correctness.`,
      code: [
        {
          language: 'typescript',
          title: 'Phi accrual failure detector (normal-distribution approximation)',
          code: `export class PhiAccrualDetector {
  private intervals: number[] = [];
  private last?: number;

  constructor(private windowSize = 1000, private minStdMs = 50) {}

  heartbeat(now = performance.now()): void {        // monotonic clock, never Date.now()
    if (this.last !== undefined) {
      this.intervals.push(now - this.last);
      if (this.intervals.length > this.windowSize) this.intervals.shift();
    }
    this.last = now;
  }

  phi(now = performance.now()): number {
    if (this.last === undefined || this.intervals.length < 3) return 0;
    const n = this.intervals.length;
    const mean = this.intervals.reduce((a, b) => a + b, 0) / n;
    const variance = this.intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.max(Math.sqrt(variance), this.minStdMs); // floor avoids over-sensitivity
    const elapsed = now - this.last;
    // P(next heartbeat later than 'elapsed') via logistic approximation of the normal CDF
    const y = (elapsed - mean) / std;
    const e = Math.exp(-y * (1.5976 + 0.070566 * y * y));
    const pLater = elapsed > mean ? e / (1 + e) : 1 - 1 / (1 + e);
    return -Math.log10(Math.max(pLater, 1e-300));
  }

  isAvailable(threshold = 8): boolean { return this.phi() < threshold; }
}`,
        },
      ],
      keyPoints: [
        'Timeouts trade failover speed for false positives; failures are only ever suspected.',
        'Phi accrual adapts to observed jitter; Cassandra default threshold 8.',
        'Gossip (SWIM) scales detection; fencing makes false positives safe.',
      ],
      source: 'Hayashibara et al. — The φ Accrual Failure Detector (2004)',
    },
    {
      heading: 'Split brain: causes and prevention',
      body: `**Intuition:** split brain is two captains on one ship, each steering. It happens when a group divides and *both* halves decide they're in charge — the worst outcome in replicated systems because both sides accept conflicting writes.

**Typical causes:**
- **Two-node clusters** or any setup where "I can't see the other node" is taken to mean "the other node is dead" (keepalived/VRRP pairs, naive primary–replica failover scripts).
- **Even splits across two datacenters** (2 + 2): neither side has a majority — safe but unavailable — or worse, a misconfigured "prefer local DC" rule lets both sides elect.
- **Stale leader after a pause** that keeps acting until it notices (see fencing).
- **Manual intervention** — an operator promotes a replica while the old primary is still alive behind a partition.

**Prevention toolkit:**
1. **Majority quorum** for leadership: an isolated minority can never elect or keep a leader (Raft/ZAB do this by construction; CheckQuorum makes old leaders step down).
2. **Odd member counts across ≥ 3 failure domains.** For two main DCs, put a **tie-breaker/witness** node in a third location (a small VM in another region/AZ) — e.g. 2 + 2 + 1.
3. **Fencing** of the old leader: fencing tokens at the storage layer, or **STONITH** ("shoot the other node in the head") — power off/revoke network or storage access (cloud API to detach the volume or remove it from the load balancer) before promoting.
4. **Leader leases with clock-bound safety margins**: new leader waits out the old lease before acting (Raft lease reads, Spanner leader leases).
5. **External coordination** for database failover: Patroni/Stolon (etcd/Consul/ZooKeeper), Orchestrator with raft, managed services' control planes.

**Detecting it after the fact:** two nodes reporting primary role, diverging GTIDs/LSN timelines, conflicting sequence values. Recovery is painful: choose a winner, replay or reconcile the loser's writes manually. That's why prevention is worth a lot of latency.`,
      diagram: `BAD: 2 DCs, 2+2                    GOOD: 2 DCs + witness, 2+2+1
 DC-A          DC-B                 DC-A        DC-B        DC-C (witness)
 [N1][N2] ╳╳╳ [N3][N4]              [N1][N2] ╳╳ [N3][N4]        [N5]
  2 of 4        2 of 4                 └────────────┬──────────────┘
  no majority either side:          side that still reaches N5 has 3/5
  unavailable (or split brain if    → keeps/elects the leader; other side
  "prefer local" hack is on)          stays read-only / unavailable`,
      keyPoints: [
        'Split brain = two leaders accepting writes; prevent it rather than repair it.',
        'Majorities over odd members in ≥ 3 failure domains; add a witness for two-DC setups.',
        'Fence the old leader (tokens, STONITH) before promoting a new one.',
      ],
    },
    {
      heading: 'Physical time: NTP skew, clock jumps and TrueTime',
      body: `**Intuition:** every server's quartz clock runs slightly fast or slow (tens of parts per million — up to a few seconds per day). NTP keeps nudging it back, but it's never exact, and sometimes it jumps.

**Realistic numbers:** within a well-run datacenter NTP/chrony keeps clocks within ~**0.1–few ms**; over the public internet, **10–100 ms**; AWS Time Sync / PTP-based services advertise **microsecond-level** accuracy on supported instances. A misconfigured node can be off by seconds or minutes, and VM pauses make a clock appear to "freeze" and then leap.

**Hazards:**
- **Jumps:** NTP may *step* a clock (instead of slewing it) when the offset is large; leap seconds (often smeared by cloud providers); a VM restored from snapshot. Time can go **backwards**.
- **Monotonic vs wall-clock:** use a monotonic clock (\`performance.now()\`, \`process.hrtime.bigint()\`, \`CLOCK_MONOTONIC\`) for durations, timeouts and leases; wall-clock (\`Date.now()\`) only for display and approximate timestamps.
- **LWW with skew** silently drops writes (see *ds-consistency*); **Snowflake IDs** duplicate on rollback; **TTL/lease** logic across machines misfires; log correlation across services lies about ordering.

**Google TrueTime (Spanner):** \`TT.now()\` returns an interval [earliest, latest] whose width 2ε is guaranteed to contain true time, using GPS and atomic clocks in every datacenter; historically ε ranged roughly 1–7 ms. **Commit wait:** a transaction picks commit timestamp s = TT.now().latest and waits until TT.now().earliest > s before releasing locks and acknowledging. Therefore any transaction that starts after this one commits gets a larger timestamp → **external consistency** (strict serializability) globally. The cost is ~2ε of latency per read-write commit, which is why shrinking ε matters.

**Without atomic clocks:** CockroachDB uses HLC plus a configured **max clock offset** (historically 500 ms by default, 250 ms in recent versions); reads that encounter values in their "uncertainty window" restart at a higher timestamp, and nodes whose clocks drift beyond the bound shut themselves down. Similar idea, cheaper hardware, occasional read restarts.`,
      keyPoints: [
        'Clocks drift, step and go backwards; use monotonic clocks for durations.',
        'TrueTime exposes uncertainty ε; commit wait of ~2ε gives external consistency.',
        'CockroachDB: HLC + max clock offset + uncertainty restarts instead of atomic clocks.',
      ],
      source: 'Corbett et al. — Spanner (OSDI 2012)',
    },
    {
      heading: 'Logical clocks: Lamport, vector clocks and hybrid logical clocks',
      body: `**Intuition:** if you can't trust wall clocks, count *events* instead. Logical clocks capture "happened-before" (→): A → B if A precedes B on the same process, or A is a send and B the matching receive, or transitively.

**Lamport clock:** one integer per process. Increment before each event; attach to messages; on receive set \`clock = max(local, received) + 1\`. Guarantee: if A → B then L(A) < L(B). **Not the converse**: L(A) < L(B) doesn't tell you whether A caused B or they were concurrent. With (counter, nodeId) tie-breaking you get a **total order** consistent with causality — enough for things like ordering operations in a replicated log or mutual exclusion.

**Vector clock:** a vector of counters, one per process. Increment your own entry on each event; on receive take element-wise max then increment your own. Compare: V(A) ≤ V(B) element-wise (and ≠) ⇔ A → B; if neither ≤ the other, **A ∥ B (concurrent)**. That's exactly what conflict detection needs (Dynamo siblings, Riak). Cost: O(#participants) per timestamp — keep the participants to replicas (version vectors), not clients, or the vectors explode.

**Hybrid Logical Clock (HLC):** a pair (l, c) where l tracks the max physical time seen and c is a logical counter for events within the same l. Properties: respects causality like Lamport, stays within the clock-skew bound of physical time (so timestamps are meaningful for humans and for "read as of time t" snapshots), and fits in 64 bits (e.g. 48 bits ms + 16 bits counter). Used by CockroachDB, YugabyteDB, MongoDB (cluster time) and many CDC/event systems.

| Clock | Size | Captures causality | Detects concurrency | Close to real time |
|---|---|---|---|---|
| Wall clock | 64 bit | No | No | Yes (with skew) |
| Lamport | 64 bit | One direction (A→B ⇒ L(A)<L(B)) | No | No |
| Vector | N × 64 bit | Both directions | **Yes** | No |
| HLC | 64 bit | One direction | No | **Yes** (within skew) |`,
      code: [
        {
          language: 'typescript',
          title: 'Lamport and vector clocks',
          code: `export class LamportClock {
  private t = 0;
  tick(): number { return ++this.t; }                            // local event or send
  receive(remote: number): number { this.t = Math.max(this.t, remote) + 1; return this.t; }
}

export type VC = Record<string, number>;

export class VectorClock {
  private v: VC = {};
  constructor(private readonly id: string) {}

  tick(): VC { this.v[this.id] = (this.v[this.id] ?? 0) + 1; return { ...this.v }; }

  receive(remote: VC): VC {
    for (const [k, n] of Object.entries(remote)) this.v[k] = Math.max(this.v[k] ?? 0, n);
    return this.tick();                                          // receive is an event too
  }
}

// 'before' => a happened-before b; 'concurrent' => neither saw the other (conflict!)
export function compare(a: VC, b: VC): 'before' | 'after' | 'equal' | 'concurrent' {
  let aLess = false, bLess = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0, y = b[k] ?? 0;
    if (x < y) aLess = true;
    if (y < x) bLess = true;
  }
  if (aLess && bLess) return 'concurrent';
  if (aLess) return 'before';
  if (bLess) return 'after';
  return 'equal';
}
// compare({A:3,B:2}, {A:2,B:3}) === 'concurrent'`,
        },
        {
          language: 'typescript',
          title: 'Hybrid logical clock (HLC) — 48-bit physical ms + 16-bit logical counter',
          code: `export interface Hlc { l: number; c: number } // l: ms (physical component), c: counter

export class HybridClock {
  private last: Hlc = { l: 0, c: 0 };
  constructor(private readonly physicalNow = () => Date.now(), private readonly maxOffsetMs = 500) {}

  // Local event or message send
  now(): Hlc {
    const pt = this.physicalNow();
    if (pt > this.last.l) this.last = { l: pt, c: 0 };   // physical time moved on
    else this.last = { l: this.last.l, c: this.last.c + 1 }; // same ms or clock went back
    return { ...this.last };
  }

  // Message receive: never go below what the sender has seen
  update(remote: Hlc): Hlc {
    const pt = this.physicalNow();
    if (remote.l - pt > this.maxOffsetMs) throw new Error('remote clock too far ahead; refusing');
    const l = Math.max(this.last.l, remote.l, pt);
    let c: number;
    if (l === this.last.l && l === remote.l) c = Math.max(this.last.c, remote.c) + 1;
    else if (l === this.last.l) c = this.last.c + 1;
    else if (l === remote.l) c = remote.c + 1;
    else c = 0;
    this.last = { l, c };
    return { ...this.last };
  }
}

// Pack into one sortable 64-bit value (BigInt)
export const pack = (h: Hlc) => (BigInt(h.l) << 16n) | BigInt(h.c & 0xffff);`,
        },
      ],
      keyPoints: [
        'Lamport: causality implies order, not vice versa; tie-break for a total order.',
        'Vector clocks detect concurrency at O(participants) cost.',
        'HLC: 64-bit, causality-respecting, close to wall time — the modern default.',
      ],
      source: 'Lamport (1978); Kulkarni et al. — HLC (2014)',
    },
  ],
  codeChallenges: [
    {
      id: 'ds-consensus-cc-1',
      title: 'Make a "single active worker" lock safe against pauses',
      context:
        'A billing service runs 4 replicas; only one may run the nightly invoice job, which writes invoices and charges cards through a payment provider. Last month a 20-second GC pause led to two replicas running the job concurrently and ~300 customers were charged twice.',
      task: 'Explain every way two workers can act at once with this code, then redesign it so a paused or partitioned ex-leader cannot corrupt state or double-charge, even if it wakes up mid-job.',
      starter: {
        language: 'typescript',
        title: 'invoice-job.ts (starter)',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis();
const db = new Pool();

export async function runNightly(workerId: string) {
  const ok = await redis.set('lock:invoice-job', workerId, 'PX', 10_000, 'NX');
  if (!ok) return; // someone else has it

  const customers = await db.query('SELECT id FROM customers WHERE billing_day = CURRENT_DATE');
  for (const c of customers.rows) {
    // check we still hold the lock before each customer
    if ((await redis.get('lock:invoice-job')) !== workerId) return;
    const inv = await db.query(
      'INSERT INTO invoices (customer_id, period) VALUES ($1, CURRENT_DATE) RETURNING id, amount',
      [c.id]);
    await chargeCard(c.id, inv.rows[0].amount);   // external PSP call
  }
  await redis.del('lock:invoice-job');            // release
}

declare function chargeCard(customerId: string, amount: number): Promise<void>;`,
      },
      hints: [
        'The job takes 40 minutes; the lock lives 10 seconds and is never renewed. What happens at second 11? And what can happen between the "still hold the lock?" check and the INSERT?',
        'Look at the release: can a worker delete a lock it no longer owns?',
        'Neither the database nor the payment provider knows which leader is current. What would let them reject a stale leader, and what would make a duplicate charge harmless even if two workers slip through?',
      ],
      solution: {
        language: 'typescript',
        title: 'invoice-job.ts (solution) — lease + fencing token + idempotency',
        code: `import { Etcd3 } from 'etcd3';
import { Pool } from 'pg';

const etcd = new Etcd3({ hosts: process.env.ETCD_HOSTS!.split(',') });
const db = new Pool();
const KEY = '/leaders/invoice-job';

export async function runNightly(workerId: string): Promise<void> {
  const lease = etcd.lease(15);                        // renewed automatically every ~5 s
  const leaseId = await lease.grant();
  let lost = false;
  lease.on('lost', () => { lost = true; });            // stop issuing new work ASAP

  const res = await etcd.if(KEY, 'Create', '==', 0)
    .then(etcd.put(KEY).value(workerId).lease(leaseId)).commit();
  if (!res.succeeded) { await lease.revoke(); return; }
  const token = BigInt(res.header.revision);           // monotonic fencing token

  try {
    // Register the token: fails if a newer leader has already fenced us
    const fence = await db.query(
      'UPDATE job_fence SET token = $1 WHERE job = $2 AND token < $1', [token.toString(), 'invoice']);
    if (fence.rowCount === 0) return;

    const { rows } = await db.query('SELECT id FROM customers WHERE billing_day = CURRENT_DATE');
    for (const c of rows) {
      if (lost) return;
      // Fenced + idempotent write: only the current token may write, and only once per period
      const inv = await db.query(
        'INSERT INTO invoices (customer_id, period, amount, status) ' +
        'SELECT $1, CURRENT_DATE, compute_amount($1), $3 ' +
        'WHERE (SELECT token FROM job_fence WHERE job = $2) = $4 ' +
        'ON CONFLICT (customer_id, period) DO NOTHING RETURNING id, amount',
        [c.id, 'invoice', 'PENDING', token.toString()]);
      if (!inv.rowCount) continue;                     // fenced, or invoiced already

      // PSP dedupes on the idempotency key: a stale worker retrying cannot double-charge
      await chargeCard(c.id, inv.rows[0].amount, 'invoice-' + inv.rows[0].id);
      await db.query('UPDATE invoices SET status = $2 WHERE id = $1', [inv.rows[0].id, 'CHARGED']);
    }
  } finally {
    await lease.revoke();                              // deletes KEY only if it's still our lease
  }
}

declare function chargeCard(customerId: string, amount: number, idempotencyKey: string): Promise<void>;
// Schema: job_fence(job text primary key, token bigint not null);
//         invoices UNIQUE (customer_id, period)`,
      },
      explanation: `**Why two workers ran:**
- The 10 s TTL is **never renewed** for a 40-minute job, so any other replica acquires the lock at second 11.
- The **check-then-act** ownership check is racy: a GC pause after \`GET\` returns but before the INSERT/charge lets a stale worker act after expiry.
- \`DEL\` releases **someone else's lock** if ours expired (should be compare-and-delete).
- Nothing downstream can tell a stale worker from the current one, and the charge is **not idempotent**.

**Fixes:**
- **Lease with keep-alive** in etcd (consensus-backed, linearizable) and a \`lost\` handler that stops new work.
- **Fencing token** = etcd revision of the leader key; the DB records the highest token in \`job_fence\` and every write is conditional on it, so a woken-up ex-leader's writes are rejected *by the resource*.
- **Idempotency at every side effect:** \`UNIQUE (customer_id, period)\` + \`ON CONFLICT DO NOTHING\` for invoices, and a deterministic **PSP idempotency key** per invoice so even a charge retried by a stale or crashed worker is deduplicated by the provider.
- **Release** by revoking our own lease: it can't delete a key owned by a newer lease.
- The job is **resumable**: re-running skips invoiced customers.`,
      followUps: [
        {
          "q": "The PSP charge succeeds but the worker dies before marking the invoice CHARGED. What happens on the next run?",
          "a": "The invoice row exists with status PENDING, so `ON CONFLICT DO NOTHING` returns 0 rows and the loop skips it — the customer was charged but the invoice is stuck PENDING, and a genuinely failed charge would never be retried either. Add a recovery step: for PENDING invoices older than a few minutes, call `chargeCard` again with the same idempotency key (the PSP returns the original result) or query the PSP by key, then update the status. That makes the job resumable for every crash point."
        },
        {
          "q": "How would you prove in a test that a paused ex-leader can't double-charge?",
          "a": "Run two workers against real etcd and Postgres with a fake PSP that records idempotency keys. Let worker A acquire and process a few customers, then freeze it (SIGSTOP or a test hook) past the lease TTL. Worker B acquires a higher revision and runs. Unfreeze A so it continues its loop. Assert: every one of A's post-pause INSERTs was fenced (0 rows), the PSP saw each idempotency key once per invoice, and invoice count equals customer count. Repeat with partitions injected via toxiproxy."
        }
      ],
    },
    {
      id: 'ds-consensus-cc-2',
      title: 'Fix a homegrown Raft vote handler that elects two leaders',
      context:
        'An internal metadata service implements a simplified Raft. Chaos tests occasionally show two leaders in the same term and, rarely, a committed entry disappearing after a failover.',
      task: 'Find the safety bugs in the election path and fix them so there is at most one leader per term and a new leader always holds every committed entry.',
      starter: {
        language: 'typescript',
        title: 'raft-election.ts (starter)',
        code: `export class Node {
  term = 0;
  votedFor: string | null = null;
  log: { term: number }[] = [];
  role: 'follower' | 'candidate' | 'leader' = 'follower';

  onRequestVote(req: { term: number; candidateId: string; lastLogIndex: number }) {
    if (req.term < this.term) return { term: this.term, granted: false };
    this.term = req.term;
    // vote for whoever asks first, or anyone with a longer log
    if (this.votedFor === null || req.lastLogIndex > this.log.length) {
      this.votedFor = req.candidateId;
      return { term: this.term, granted: true };   // persisted asynchronously later
    }
    return { term: this.term, granted: false };
  }

  onAppendEntries(req: { term: number }) {
    if (req.term < this.term) return { term: this.term, success: false };
    this.role = 'follower';
    return { term: this.term, success: true };
  }

  electionTimeoutMs() { return 200; }
}`,
      },
      hints: [
        'When a higher term arrives, what must happen to votedFor? What about the case where the node already voted in this term and a second candidate with a longer log asks?',
        'Is log length the right measure of "up to date"? Consider a node with a long log of entries from an old term.',
        'What happens to a vote after a crash if it wasn\'t persisted before replying? And what does a fixed 200 ms timeout do when all followers lose the leader at the same moment?',
      ],
      solution: {
        language: 'typescript',
        title: 'raft-election.ts (solution)',
        code: `interface Persisted { term: number; votedFor: string | null }

export class Node {
  term = 0;
  votedFor: string | null = null;
  log: { term: number }[] = [];
  role: 'follower' | 'candidate' | 'leader' = 'follower';

  constructor(private save: (s: Persisted) => Promise<void>) {}

  private async observeTerm(t: number): Promise<void> {
    if (t > this.term) {
      this.term = t;
      this.votedFor = null;          // new term: vote is fresh
      this.role = 'follower';        // any leader/candidate steps down
      await this.save({ term: this.term, votedFor: null });
    }
  }

  async onRequestVote(req: { term: number; candidateId: string; lastLogIndex: number; lastLogTerm: number }) {
    await this.observeTerm(req.term);
    if (req.term < this.term) return { term: this.term, granted: false };

    const myLastTerm = this.log.at(-1)?.term ?? 0;
    const upToDate = req.lastLogTerm > myLastTerm ||
      (req.lastLogTerm === myLastTerm && req.lastLogIndex >= this.log.length);
    const free = this.votedFor === null || this.votedFor === req.candidateId; // at most ONE per term

    if (free && upToDate) {
      this.votedFor = req.candidateId;
      await this.save({ term: this.term, votedFor: this.votedFor }); // durable BEFORE replying
      return { term: this.term, granted: true };
    }
    return { term: this.term, granted: false };
  }

  async onAppendEntries(req: { term: number }) {
    await this.observeTerm(req.term);
    if (req.term < this.term) return { term: this.term, success: false };
    this.role = 'follower';          // same-term leader exists: candidates yield
    // ...log matching check, append, commit index (omitted)
    return { term: this.term, success: true };
  }

  // Randomised to break symmetric split votes; must be >> heartbeat interval and RTT
  electionTimeoutMs(): number { return 150 + Math.floor(Math.random() * 150); }
}`,
      },
      explanation: `**Safety bugs:**
- **Double voting:** "or anyone with a longer log" lets a node vote for a second candidate in the same term → two candidates can each gather a majority → **two leaders in one term**.
- **Term update without resetting the vote:** on a higher term the old \`votedFor\` carries over, so the node may wrongly refuse (liveness) or, combined with the rule above, vote twice.
- **Wrong up-to-date check:** comparing log *length* ignores terms. A node with a long log of stale, uncommitted old-term entries could win against a node holding a newer committed entry → **committed entry lost**. Raft compares last log term first, then index.
- **Vote not persisted before replying:** after a crash and restart the node forgets it voted and can vote again in the same term.
- **Leaders/candidates didn't step down** on seeing a higher term.
- **Fixed timeout:** all followers time out simultaneously → repeated split votes (liveness).

**Fixes:** a single \`observeTerm\` rule (higher term ⇒ update, clear vote, become follower, persist), one vote per term, the (lastLogTerm, lastLogIndex) election restriction, durable vote before responding, and randomised election timeouts.`,
      followUps: [
        {
          "q": "Election safety is fixed. How does a newly elected leader handle followers whose logs have extra, conflicting entries from old terms?",
          "a": "Through AppendEntries consistency checks: the leader sends prevLogIndex/prevLogTerm with each request; a follower whose entry at that index has a different term rejects it, and the leader decrements nextIndex (or jumps back using the conflict term hint) and retries. Once they match, the follower deletes its conflicting suffix and appends the leader's entries. Only uncommitted entries can be overwritten this way, since the election restriction guarantees the leader already has every committed entry."
        },
        {
          "q": "How would you test this vote handler so the chaos-test bug can't come back?",
          "a": "Unit-test invariants directly: a node asked twice in the same term grants at most one vote; a higher term resets votedFor and steps the node down; a candidate with longer log but lower last term is refused; the vote is persisted before the reply (inject a crash between save and reply and restart). Then run a randomized simulation with a deterministic network (drops, reorders, partitions, crashes) and assert at most one leader per term and that committed entries are never lost, as Jepsen and etcd's raft tests do."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'ds-consensus-iq-01',
      difficulty: 'hard',
      question:
        'Walk me through what happens in a 5-node Raft cluster when the leader is partitioned away with one follower, while clients keep talking to both sides.',
      whatInterviewerLooksFor: [
        'Majority side elects a new leader with a higher term; minority leader cannot commit',
        'Explains fate of uncommitted entries on the minority side after healing',
        'Addresses stale reads from the old leader and how ReadIndex/CheckQuorum/leases prevent them',
        'Client behaviour: timeouts, retries, idempotency',
      ],
      modelAnswer: `### Setup
Nodes L (leader, term 7) and F1 on side A; F2, F3, F4 on side B.

### Side B (majority, 3 nodes)
F2–F4 stop receiving heartbeats; after a randomised election timeout one of them (say F3) becomes candidate for **term 8** and wins with 3 votes (it has every committed entry, thanks to the election restriction). F3 starts serving writes; they commit with 3/5 acks.

### Side A (minority, 2 nodes)
L still thinks it's leader of term 7. It can append client writes to its log and send them to F1, but can only get **2 of 5** acks → **nothing commits**; clients see timeouts. With **CheckQuorum**, L steps down after an election timeout without majority contact; F1 may try elections but can't win (PreVote stops it from inflating terms).

### Reads
Danger: L could serve reads from its local state that are now stale (side B has committed newer writes). Prevent with **ReadIndex** (leader confirms it's still leader via a heartbeat round to a majority before answering — fails on side A) or **lease reads** (valid only while its lease, shorter than the election timeout, hasn't expired — depends on bounded clock drift). etcd defaults to ReadIndex-based linearizable reads; serializable (local) reads are opt-in.

### Healing
L and F1 receive messages with term 8 → step down to followers. Their **uncommitted term-7 entries are overwritten** by the log matching check. Clients that timed out don't know if their write happened: they must **retry with idempotency keys** (a Raft-backed service typically dedupes on client ID + sequence number).

### Summary
Safety is never violated; availability is lost only on the minority side — a textbook CP behaviour.`,
      followUps: [
        {
          q: 'What if the partition is 2 | 2 | 1?',
          a: 'No side has 3 nodes, so no leader can be elected or keep committing; the cluster is unavailable for writes until connectivity restores a majority.',
        },
        {
          q: 'Why is PreVote important when the partition heals?',
          a: 'Without it, an isolated follower keeps incrementing its term during failed elections; on rejoining, its high term forces the healthy leader to step down, causing a needless election. PreVote only increments the term if a majority would grant the vote.',
        },
      ],
      pitfalls: [
        'Saying the old leader keeps committing writes on its side.',
        'Ignoring stale reads from the deposed leader.',
        'Assuming uncommitted entries are preserved.',
      ],
    },
    {
      id: 'ds-consensus-iq-02',
      difficulty: 'hard',
      question:
        'We run a job scheduler as 3 Kubernetes pods. Exactly one should dispatch jobs at any time, and failover should take under 15 seconds. Design the leader election.',
      whatInterviewerLooksFor: [
        'Uses a consensus-backed store or Kubernetes Lease, not ad-hoc Redis',
        'Explains TTL/renewal/failover timing math',
        'Adds fencing tokens and idempotent job dispatch',
        'Considers GC pauses, network partitions and graceful handover',
      ],
      modelAnswer: `### Mechanism
Use a **lease in a linearizable store**: Kubernetes \`coordination.k8s.io/v1\` Lease objects (backed by etcd, used by kube-controller-manager and client-go's leaderelection) or etcd directly.
- **leaseDuration 10 s, renewDeadline 8 s, retryPeriod 2 s** (client-go style). The leader renews every 2 s; if it can't renew within 8 s it **stops leading itself**; others take over after the 10 s lease expires → failover ≈ 10–12 s < 15 s.
- On graceful shutdown (SIGTERM) the leader releases the lease → failover ≈ 2 s.

### Fencing
A lease alone doesn't stop a paused leader. Each acquisition increments a **fencing token** (etcd revision, or a \`leaderTransitions\` counter / resourceVersion on the Lease). Dispatch writes carry the token:
- Job rows are claimed with \`UPDATE jobs SET state='DISPATCHED', token=$t WHERE id=$1 AND state='READY' AND $t >= (SELECT max_token FROM scheduler_fence)\`.
- Workers accept only dispatches whose token ≥ the highest they've seen.

### Idempotency
Each job execution has a deterministic key (job_id + scheduled_time). Workers dedupe on it; side effects downstream use it as an idempotency key. So even if two leaders overlap briefly, a job runs at most once in effect.

### Other details
- Leader loop checks a local "am I still leader" flag set by the renewal goroutine/timer; long operations are chunked so the flag is re-checked often.
- Use monotonic clocks for renewal deadlines.
- Metrics: current leader, transitions/hour (flapping alert), renewal latency.
- Don't use a single Redis \`SET NX PX\` for this: no fencing token, and Redis failover can lose the lock key.`,
      followUps: [
        {
          q: 'What does renewDeadline < leaseDuration buy you?',
          a: 'A safety margin: the leader gives up leadership (stops dispatching) before its lease can expire and another pod can acquire it, reducing overlap to cases of pauses/clock issues — which fencing covers.',
        },
        {
          q: 'Could you avoid leader election entirely?',
          a: 'Yes: have all pods compete per job with an atomic claim (SELECT … FOR UPDATE SKIP LOCKED in Postgres), which spreads work and needs no leader; election is only needed for singleton responsibilities.',
        },
      ],
      pitfalls: [
        'Lease without fencing.',
        'Failover time math that ignores lease duration.',
        'Using wall-clock comparisons across pods to decide leadership.',
      ],
    },
    {
      id: 'ds-consensus-iq-03',
      difficulty: 'expert',
      question:
        'A teammate proposes Redlock (5 independent Redis masters) to guarantee only one service instance writes a customer\'s ledger at a time. Do you approve?',
      whatInterviewerLooksFor: [
        'Distinguishes efficiency locks from correctness locks',
        'Explains the timing assumptions Redlock relies on (clock drift, pauses, network delay)',
        'Explains missing fencing tokens and why checking TTL does not help',
        'Proposes a correct alternative (DB constraints/transactions, consensus-backed lock + fencing)',
      ],
      modelAnswer: `### Short answer: not for a ledger
Redlock acquires a lock on a majority of 5 Redis masters with a TTL, accounting for elapsed time. It's reasonable for **efficiency** (avoid two workers doing the same expensive but harmless work). For **correctness** (a ledger must never receive interleaved writes), it has two problems:

1. **No fencing token.** A client can acquire the lock, pause (GC, VM stall) past the TTL, and then write while another client holds the lock. Checking the TTL right before writing doesn't help — the pause can occur between check and write, or the write can sit in a network buffer. Without a monotonically increasing token that the *ledger store checks*, nothing rejects the stale write.
2. **Timing assumptions.** Safety depends on bounded clock drift, bounded pauses and bounded network delay across the 5 masters. A clock jump on one Redis node can expire a key early, letting a second client gather a majority. A Redis restart without fsync (default AOF \`everysec\`) can forget a lock unless restarts are delayed by the TTL.

### What I'd do instead
- The ledger store should enforce correctness itself: **serializable transactions or row locks** in the ledger DB (\`SELECT … FOR UPDATE\` on the account row), plus **optimistic concurrency** (\`UPDATE … WHERE version = $v\`). Then no external lock is needed at all.
- If a lease is truly needed (single writer per customer across services), use a **consensus-backed lock** (etcd/ZooKeeper) and pass its revision as a **fencing token** with every write; the ledger rejects lower tokens.
- Make ledger entries **idempotent** (unique transaction IDs) so retries never double-post.

### Where Redlock (or plain SET NX PX) is fine
Deduplicating cron runs, throttling cache rebuilds, avoiding duplicate emails where a rare duplicate is tolerable.`,
      followUps: [
        {
          q: 'If Redis had a fencing counter (INCR on acquire), would single-instance Redis be enough?',
          a: 'Tokens fix the pause problem only if the resource checks them, and a single Redis failing over asynchronously can lose the lock and even the counter; for a ledger I would still rely on the database\'s own concurrency control.',
        },
        {
          q: 'Why does "check the lock before write" fail?',
          a: 'It is check-then-act across a network: the process can pause or the request can be delayed after the check succeeds, so the write lands after expiry.',
        },
      ],
      pitfalls: [
        'Believing a majority of Redis nodes makes it as safe as consensus.',
        'Relying on TTL checks for safety.',
        'Not noticing the resource itself could enforce the invariant.',
      ],
    },
    {
      id: 'ds-consensus-iq-04',
      difficulty: 'hard',
      question:
        'We have two datacenters and want our 4-node etcd cluster (2 per DC) to survive the loss of either DC. Will it? What would you change?',
      whatInterviewerLooksFor: [
        'Quorum math: 4 nodes need 3; losing a DC leaves 2 → unavailable',
        'Explains why even sizes don\'t help and why "prefer local DC" is dangerous',
        'Proposes 5 nodes across 3 sites (2+2+1 witness) and discusses latency',
        'Mentions alternative: per-DC clusters with async replication for DR',
      ],
      modelAnswer: `### No
A 4-node cluster needs a majority of **3**. If either DC fails (or the inter-DC link fails), each side has 2 → **no quorum**, no writes, and linearizable reads fail. A 4-node cluster tolerates exactly one node failure — the same as 3 nodes, with more hardware and one more ack to wait for.

### Options
1. **Third site witness: 2 + 2 + 1** (5 voters). Lose any one DC → 3 remain → quorum. Lose the link between the two main DCs → whichever side can reach the witness keeps quorum. The witness can be a small VM in a cloud region or another AZ; it participates in votes and replication.
2. **Place the cluster in one region across 3 AZs** (the common cloud answer) and treat regional disasters with backups/snapshots + a DR cluster restored or rebuilt elsewhere.
3. **Independent clusters per DC** with application-level async replication if cross-DC consistency isn't required (e.g. per-DC Kubernetes clusters — the usual design).

### Latency considerations
Every write needs acks from a majority: with 2+2+1 the leader in DC-A needs one more ack from DC-B or the witness; if inter-site RTT is 10 ms, writes take ≥ 10 ms + fsync. Keep etcd's heartbeat interval ≈ RTT and election timeout ≥ 5–10× RTT (e.g. 100 ms / 1,000–2,000 ms for 20–50 ms RTT) to avoid spurious elections.

### Don't
Don't hack "DC-A wins ties" or allow each DC to operate independently on partition — that's split brain.`,
      followUps: [
        {
          q: 'Why not 6 nodes, 3 per DC?',
          a: 'Majority is 4: losing a DC leaves 3 → still unavailable. Even sizes never help with symmetric splits.',
        },
        {
          q: 'Where should the leader live?',
          a: 'Close to most clients to minimise client latency; etcd allows leadership transfer (move-leader), and some systems support leader preferences/priorities.',
        },
      ],
      pitfalls: [
        'Believing 4 nodes tolerate 2 failures.',
        'Suggesting a tie-break rule that permits both DCs to proceed.',
        'Ignoring cross-site latency effects on consensus timeouts.',
      ],
    },
    {
      id: 'ds-consensus-iq-05',
      difficulty: 'medium',
      question:
        'Our microservices stamp events with Date.now() and consumers sort by that timestamp to reconstruct order. We keep seeing "order shipped" before "order paid". Why, and what should we do?',
      whatInterviewerLooksFor: [
        'Explains clock skew, NTP adjustments, and that wall-clock order ≠ causal order',
        'Offers per-entity sequencing (single writer / partition order) as the practical fix',
        'Knows Lamport/HLC for causal ordering across services',
        'Knows where total order is actually needed',
      ],
      modelAnswer: `### Why
Different hosts' clocks are skewed (a few ms in a good DC, much more on a misconfigured node) and can be stepped by NTP. "Paid" emitted on host A at true time t and "shipped" on host B at t + 3 ms can carry timestamps in the reverse order if B's clock is 5 ms slow. Also, network and queue delays mean arrival order ≠ emission order. Wall clocks simply don't capture **causality** (shipping *happened after* payment because the shipping service reacted to the payment event).

### Fixes, most practical first
1. **Per-entity ordering via the log:** publish all events for an order to the same Kafka partition keyed by order_id. Kafka preserves order within a partition, and consumers process in that order. If multiple services emit events about the same order, have each include the **version/sequence** of the order aggregate it acted on (e.g. \`orderVersion: 7\`), assigned by the single writer (the order service's DB row version).
2. **Causal metadata:** propagate a **Lamport or hybrid logical clock** in event headers; every service updates HLC on receive and stamps outgoing events. Then "shipped" (caused by "paid") always has a larger HLC. HLC keeps timestamps close to wall time for humans.
3. **Consumer-side tolerance:** state machines that reject/buffer out-of-order transitions (e.g. shipped before paid → park and retry), and idempotent handlers.

### When wall clocks are OK
Approximate analytics, TTLs, logs for humans (with awareness of skew). Never for correctness decisions like LWW conflict resolution or ordering money movements.`,
      followUps: [
        {
          q: 'Could we just make NTP better?',
          a: 'Better sync (chrony, PTP, AWS Time Sync) shrinks skew but never to zero, and doesn\'t fix queue/network reordering; you still need logical ordering for correctness.',
        },
        {
          q: 'Why not a global sequencer service?',
          a: 'It works (a total order), but it is a bottleneck and single point of failure; you usually only need order per entity, which partitioning gives for free.',
        },
      ],
      pitfalls: [
        'Proposing more precise timestamps (nanoseconds) as the fix.',
        'Requiring a global total order when per-entity order suffices.',
        'Ignoring reordering in transit.',
      ],
    },
    {
      id: 'ds-consensus-iq-06',
      difficulty: 'expert',
      question:
        'Our Kafka-like metadata cluster (Raft-based) keeps flapping leaders every few minutes during peak traffic. There are no crashes. Diagnose and fix.',
      whatInterviewerLooksFor: [
        'Recognises false-positive failure detection (heartbeats delayed, not nodes dead)',
        'Lists causes: GC pauses, fsync latency, CPU saturation, network jitter, heartbeats sharing queues with bulk traffic',
        'Proposes tuning (timeouts, PreVote/CheckQuorum), isolation, and measurement',
        'Discusses the cost of flapping and adaptive detectors',
      ],
      modelAnswer: `### Hypothesis
Leaders aren't dying — followers **suspect** them because heartbeats arrive later than the election timeout. Each spurious election costs ~1–2 s of write unavailability and client retries (which add load, which delays heartbeats more — a feedback loop).

### Evidence to collect
- Leader-change timestamps vs **GC pause logs** (JVM safepoint/GC or Go GC), **fsync latency** (etcd: \`wal_fsync_duration_seconds\` p99; Raft appends block on disk), CPU steal/saturation, network RTT/jitter and packet loss between members.
- Are heartbeats processed on the same thread/queue as large AppendEntries or snapshot transfers? A big snapshot transfer can starve heartbeats.
- Term numbers: rapidly increasing terms from one node indicate a node disrupting elections (no PreVote).

### Fixes
1. **Remove the stall source:** tune GC (smaller heaps, pause-oriented collectors), move WAL to dedicated low-latency SSD, throttle snapshot/replication bandwidth, give the metadata cluster dedicated nodes (no noisy neighbours).
2. **Tune timeouts to reality:** heartbeat ≈ RTT-ish (e.g. 100 ms), election timeout ≥ 10× heartbeat and > p99.9 of observed stalls (e.g. 1–3 s). Faster failover isn't worth constant false failovers.
3. **Enable PreVote and CheckQuorum** so an isolated or slow node can't depose a healthy leader and stale leaders step down cleanly.
4. **Prioritise heartbeats:** separate channels/threads for heartbeats vs bulk replication.
5. **Adaptive detection** (phi accrual) where the system supports it, and alerting on leader transitions/hour.

### Validate
Chaos/load test with injected GC pauses and disk latency; target zero leader changes at 2× peak.`,
      followUps: [
        {
          q: 'Why do slow disks cause leader elections in etcd?',
          a: 'The leader must fsync entries and followers fsync before acking; if fsync stalls, the leader\'s heartbeats/AppendEntries are delayed beyond followers\' election timeouts, so they start elections.',
        },
        {
          q: 'Is increasing the election timeout to 30 s a good fix?',
          a: 'It stops flapping but means a real leader crash causes ~30 s of unavailability; fix the stalls and choose a timeout just above realistic pauses.',
        },
      ],
      pitfalls: [
        'Assuming nodes are crashing.',
        'Lowering timeouts to "fail over faster".',
        'Not correlating elections with GC/fsync metrics.',
      ],
    },
    {
      id: 'ds-consensus-iq-07',
      difficulty: 'expert',
      question:
        'Explain how Spanner achieves externally consistent transactions globally, and how CockroachDB approximates it without atomic clocks. What does each cost?',
      whatInterviewerLooksFor: [
        'TrueTime intervals and commit wait explained precisely',
        'Relationship to real-time ordering / strict serializability',
        'HLC + max offset + uncertainty restarts in CockroachDB',
        'Latency/operational costs and failure modes (clock drift beyond bound)',
      ],
      modelAnswer: `### Spanner
- Data is split into ranges (splits), each replicated by a **Paxos** group; transactions spanning groups use **2PC over Paxos groups** (coordinator is itself replicated, so 2PC doesn't block on a single machine failure).
- **TrueTime** returns an interval [earliest, latest] guaranteed to contain real time, with half-width ε (historically ~1–7 ms) from GPS + atomic clocks.
- **Commit wait:** the leader assigns commit timestamp s ≥ TT.now().latest, then waits until TT.now().earliest > s before making the commit visible and replying. Any transaction starting after the reply gets a timestamp > s. So **timestamp order = real-time order** → external consistency (strict serializability).
- Also enables lock-free **snapshot reads at a timestamp** anywhere.
- **Cost:** ~2ε added latency per read-write commit (a few ms), plus Paxos + cross-region RTTs; special hardware and time infrastructure.

### CockroachDB
- Raft per range; transactions use **HLC** timestamps and a configured **max clock offset** (hundreds of ms).
- A read at timestamp t that finds a value with timestamp in (t, t + max_offset] can't tell whether that write happened before it in real time → **uncertainty restart**: bump the read timestamp and retry.
- Commit-wait is not done by default, so CockroachDB guarantees **serializability** and linearizability per key, but not full strict serializability for all transaction pairs in pathological skew cases.
- Nodes that detect their clock beyond the max offset relative to peers **shut down** to preserve correctness.
- **Cost:** occasional read restarts (latency spikes), dependency on NTP discipline; no special hardware.

### Takeaway
Both use time to avoid global coordination for ordering; Spanner pays in fixed commit latency with tight bounds, CockroachDB pays in occasional retries with looser bounds.`,
      followUps: [
        {
          q: 'What happens to Spanner if ε grows (e.g. GPS outage)?',
          a: 'TrueTime widens ε using the atomic clocks\' drift bounds; commits still stay correct but commit wait grows, so latency rises rather than correctness failing.',
        },
        {
          q: 'Why is an HLC timestamp better than a plain wall-clock timestamp here?',
          a: 'HLC never goes backwards and captures causality (a transaction after reading a value gets a larger timestamp), while staying within the skew bound of physical time.',
        },
      ],
      pitfalls: [
        'Saying Spanner "has perfectly synchronised clocks".',
        'Confusing commit wait with 2PC.',
        'Claiming CockroachDB is identical to Spanner without atomic clocks.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'ds-consensus-boe-1',
      question:
        'Estimate commit latency and maximum write throughput of a single 3-node Raft group spread across 3 AZs, and how many groups you need for 200K writes/s.',
      assumptions: [
        'Cross-AZ RTT ≈ 1 ms; NVMe fsync ≈ 0.5 ms',
        'Leader fsyncs locally in parallel with sending to followers; followers fsync before acking',
        'Pipelining + batching: leader batches entries every ~1 ms; ~50 KB per batch at 250-byte entries ≈ 200 entries/batch',
        'Practical per-group ceiling limited by leader CPU/network: ~20–40K small writes/s',
      ],
      steps: [
        { label: 'Commit latency', calc: 'max(leader fsync 0.5 ms, RTT 1 ms + follower fsync 0.5 ms) ≈ 1.5 ms + apply ≈ 2 ms' },
        { label: 'Unbatched, one-at-a-time throughput', calc: '1 ÷ 2 ms ≈ 500 writes/s — why batching/pipelining is essential' },
        { label: 'Batched throughput', calc: '~200 entries per ~2 ms round ≈ 100K/s theoretical; CPU/network caps it at ~20–40K/s' },
        { label: 'Groups for 200K writes/s', calc: '200K ÷ 25K ≈ 8 groups; ×2 headroom → ~16 groups (ranges/partitions)' },
      ],
      answer:
        '~2 ms per commit; ~20–40K writes/s per group with batching; ~8–16 Raft groups (partitions) for 200K writes/s.',
      insight:
        'A single consensus group has one leader — a throughput ceiling. Scale by partitioning into many groups (CockroachDB ranges, TiKV regions, Kafka partitions with KRaft metadata), and keep each transaction to one group when you can; cross-group transactions need 2PC on top.',
      followUps: [
        {
          "q": "Compliance requires the 3 replicas to be in 3 different regions with ~70 ms RTT between them. Redo the latency and throughput.",
          "a": "Commit latency becomes ≈ one cross-region RTT to the nearest follower + fsync: ~70 + 1.5 ≈ 72 ms. Unbatched one-at-a-time throughput collapses to ~1 ÷ 0.0715 s ≈ 14 writes/s, so pipelining (many in-flight batches) becomes essential. Throughput can still approach the CPU/network ceiling if batches are pipelined, but each client sees ~70+ ms. Place the leader in the region with most writers, and use leader-local or follower reads to keep reads off the WAN."
        },
        {
          "q": "With 16 groups, some transactions touch two partitions. What extra cost does that add?",
          "a": "A cross-group transaction needs two-phase commit across group leaders: a prepare round (each group writes a prepare record through its own Raft log) and then a commit round, so at least two consensus rounds instead of one — roughly 2× latency in-region, plus a coordinator record. During the in-doubt window, locks or write intents block conflicting writers. Choose partition keys so most transactions are single-group (e.g. by tenant), and keep cross-group ones rare and small."
        }
      ],
    },
    {
      id: 'ds-consensus-boe-2',
      question:
        'With heartbeat 100 ms and election timeout 1,000 ms (randomised up to 2,000 ms), how long are writes unavailable when a leader crashes, and what does that do to monthly availability with 6 unplanned failovers per month?',
      assumptions: [
        'Followers detect loss after their randomised election timeout: 1.0–2.0 s, first one fires at ~1.1 s on average with 2 followers',
        'Election round: RequestVote + fsync + votes ≈ 5 ms; new leader\'s no-op commit ≈ 2 ms',
        'Client retry backoff adds ~0.5 s on average after the new leader is known',
        'Month ≈ 2.6M seconds',
      ],
      steps: [
        { label: 'Detection', calc: '≈ 1.1 s (earliest randomised timeout among followers)' },
        { label: 'Election + first commit', calc: '≈ 5 ms + 2 ms ≈ 0.01 s (split vote adds another ~1–2 s occasionally)' },
        { label: 'Client-perceived gap', calc: '1.1 + 0.01 + 0.5 ≈ 1.6 s per failover' },
        { label: 'Monthly downtime', calc: '6 × 1.6 s ≈ 10 s' },
        { label: 'Availability impact', calc: '10 ÷ 2.6M ≈ 0.0004% → 99.9996% (failover alone)' },
      ],
      answer:
        '~1.5–2 s of write unavailability per crash; ~10 s/month for 6 failovers — negligible against a 99.99% budget (≈ 4.3 min/month).',
      insight:
        'Consensus failover is fast enough that the real risk is false failovers: if GC pauses trigger 50 spurious elections a day, that\'s ~40 minutes a month and constant retry storms. Tune timeouts above realistic pauses rather than chasing sub-second failover.',
      followUps: [
        {
          "q": "GC pauses cause spurious elections, so you raise the election timeout to 5–10 s. What does a real crash cost now?",
          "a": "Detection becomes the earliest of the two followers' randomised timeouts in 5–10 s: expected minimum ≈ 5 + 5/3 ≈ 6.7 s. Adding ~0.5 s client retry gives ~7.2 s per failover, so 6 crashes ≈ 43 s/month, still about 99.998% from failover alone. The trade is reasonable if it eliminates dozens of false elections a day, but fix GC directly too (smaller heap, concurrent collector), since a 5 s timeout also slows planned leadership transfers if you rely on timeouts for them."
        },
        {
          "q": "Planned deployments restart each node monthly. How do you avoid even the 1.6 s gap for those?",
          "a": "Use explicit leadership transfer before stopping the leader: the leader stops accepting new proposals, brings the chosen follower fully up to date, and sends it TimeoutNow so it starts an election immediately (etcd `move-leader`, Raft leadership transfer extension). The gap drops to roughly one election round of milliseconds. Restart followers first and the leader last, one at a time, waiting for each to catch up, so you never lose quorum."
        }
      ],
    },
    {
      id: 'ds-consensus-boe-3',
      question:
        'A Dynamo-style store considers attaching vector clocks to every key. Compare the metadata cost of per-client vector clocks vs per-replica version vectors for 2 billion keys.',
      assumptions: [
        'Each vector entry = 8-byte actor id + 8-byte counter = 16 bytes',
        'Per-client: a popular key is written by up to 200 distinct clients over its life (entries accumulate unless pruned)',
        'Per-replica: N = 3 replicas per key (plus occasional hand-off nodes → ≤ 5 entries)',
        'Average value size 500 bytes',
      ],
      steps: [
        { label: 'Per-client, popular key', calc: '200 × 16 B = 3.2 KB per key — 6.4× the value itself' },
        { label: 'Per-client, average (say 20 writers)', calc: '20 × 16 B = 320 B; × 2B keys ≈ 640 GB of metadata' },
        { label: 'Per-replica version vector', calc: '≤ 5 × 16 B = 80 B; × 2B keys ≈ 160 GB (typically 3 × 16 = 48 B → 96 GB)' },
        { label: 'Values for reference', calc: '2B × 500 B = 1 TB' },
      ],
      answer:
        'Per-client vectors can add ~640 GB (and 3 KB+ on hot keys); per-replica version vectors ~100–160 GB — roughly 4–6× less.',
      insight:
        'Track causality per replica (version vectors / dotted version vectors, as Riak does) rather than per client, and prune entries — or use HLC timestamps + LWW where concurrent writes are acceptable to lose. Metadata size is a first-class design constraint for causality tracking.',
      followUps: [
        {
          "q": "Most keys are actually small counters with 50 B values. How does that change the trade-off?",
          "a": "Now even per-replica version vectors (3 × 16 B = 48 B) are about 96% of the value size, so metadata roughly doubles storage, and per-client vectors (320 B average) are over 6× the data. For counters, avoid per-key vector clocks entirely: use a CRDT PN-counter whose per-replica entries both store the value and carry causality, or HLC + LWW on per-replica partial sums. Compress actor IDs to small integers via a cluster-wide mapping, shrinking entries from 16 B to ~4–6 B."
        }
      ],
    },
  ],
  test: [
    {
      id: 'ds-consensus-mcq-01',
      difficulty: 'medium',
      question:
        'A team runs a 4-node Raft cluster "for extra safety" instead of 3. What is the effect?',
      options: [
        'It still tolerates only 1 failure (majority = 3) while adding a node that can fail and an extra ack in the majority',
        'It tolerates 2 failures instead of 1',
        'It tolerates 1 failure but writes become faster because there are more followers',
        'It cannot elect a leader because even-sized clusters are unsupported',
      ],
      correct: [0],
      explanation:
        'Majority of 4 is 3, so losing 2 nodes halts the cluster — the same fault tolerance as 3 nodes. Commits need 3 acks instead of 2, which slightly worsens tail latency, and symmetric 2|2 partitions leave no majority. Even sizes are supported, just pointless; use 3 or 5.',
      followUps: [
        {
          "q": "The team already has 4 nodes in production. Without buying a fifth, what's the safest move, and how do you change membership without downtime?",
          "a": "Remove one node to get back to 3: same fault tolerance (1 failure), fewer acks per commit, and no 2|2 deadlock. Do it with a single-server membership change (etcd `member remove`, Raft joint consensus or one-at-a-time changes), never by stopping a node and editing config files on the others. Change one member at a time and wait for the new configuration to commit before the next change, so two different majorities can never exist simultaneously. If spare capacity exists, run the fourth as a non-voting learner for reads or fast replacement."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-02',
      difficulty: 'hard',
      question:
        'In Raft, follower F has voted for candidate A in term 9. Candidate B, whose log is longer and more up to date, now requests F\'s vote for term 9. What should F do?',
      options: [
        'Grant the vote, because B\'s log is more up to date',
        'Grant the vote and revoke the vote for A',
        'Reject — a node votes at most once per term; B can win in a later term if A fails to',
        'Reject and immediately start its own election for term 9',
      ],
      correct: [2],
      explanation:
        'Election safety relies on each node granting at most one vote per term (persisted before replying); otherwise two candidates could each collect a majority in the same term. The up-to-date check is a condition for granting a vote, not a reason to change one. F can\'t start an election in term 9; it would need term 10.',
      followUps: [
        {
          "q": "F granted its vote to A, replied, and then crashed before writing votedFor to disk. After restart, B asks again for term 9. What happens, and why does it matter?",
          "a": "F has forgotten its vote, so it may grant B a vote in term 9 too. If A and B each reach a majority using F's two votes, there are two leaders in term 9, which breaks election safety and can lead to divergent committed logs. That's why Raft requires `currentTerm` and `votedFor` to be fsynced before the RequestVote reply is sent. It's an easy bug to introduce with async persistence or a disk write cache that lies about fsync."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-03',
      difficulty: 'expert',
      question:
        'A Raft leader in term 4 sees that an entry from term 2 at index 7 is now stored on a majority. What may it do?',
      code: {
        language: 'text',
        code: `Leader (term 4) log: idx 5:t2  6:t2  7:t2  8:t4
matchIndex:   A = 7,  B = 7,  C = 5,  D = 5     (5-node cluster)`,
      },
      options: [
        'Mark index 7 committed immediately because a majority stores it',
        'Commit index 7 only after all 5 nodes store it',
        'Delete index 7 because it is from an older term',
        'Not commit index 7 by counting replicas; it becomes committed once a term-4 entry (index 8) is replicated on a majority',
      ],
      correct: [3],
      explanation:
        'Raft\'s Figure 8 scenario shows a majority-replicated old-term entry can still be overwritten by a future leader, so a leader only commits entries from its current term by counting; earlier entries are committed indirectly by the log matching property. The leader never deletes its own entries, and requiring all 5 would sacrifice availability without being necessary.',
      followUps: [
        {
          "q": "The term-4 leader has no new client writes for an hour, so index 8 never gets replicated. Does index 7 stay uncommitted forever?",
          "a": "It would, which is why a new Raft leader appends a no-op entry in its own term immediately after election. Replicating that no-op to a majority commits it and, through log matching, every earlier entry including index 7. The no-op also lets the leader learn its commit index before serving linearizable reads via ReadIndex. Without it, reads could miss entries that were effectively committed by the previous leader."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-04',
      difficulty: 'hard',
      question:
        'An etcd client needs to read a key and be sure it isn\'t stale. Which behaviours are correct? Select ALL that apply.',
      options: [
        'A default (linearizable) read makes the leader confirm leadership with a quorum (ReadIndex) before serving',
        'A serializable read may be served by any member from local state and can be stale',
        'Any read served by the leader is linearizable without extra steps, because the leader always has the latest data',
        'Linearizable reads fail or time out on a member cut off from the majority',
      ],
      correct: [0, 1, 3],
      explanation:
        'etcd linearizable reads use ReadIndex so a deposed-but-unaware leader can\'t serve stale data; serializable reads trade that guarantee for latency. A leader partitioned away may not know a new leader exists, so "just ask the leader" is not enough — hence ReadIndex or leases. Without quorum contact, linearizable reads cannot complete.',
      followUps: [
        {
          "q": "ReadIndex costs a quorum round trip per read. Your read-heavy config service needs 100K linearizable reads/s with low latency. What are the options and their risks?",
          "a": "Batch ReadIndex: one heartbeat round confirms leadership for all reads queued in that window, so cost is per batch, not per read. Followers can serve linearizable reads by asking the leader for its commit index and waiting to apply it locally, spreading load. Leader leases skip the round trip entirely but depend on bounded clock drift: if a paused leader's lease seems valid while a new leader exists, it serves stale data. Use serializable reads where staleness is acceptable, such as watch-driven caches."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-05',
      difficulty: 'expert',
      question:
        'This lock-protected write runs after acquiring a 30 s lease. What can still go wrong?',
      code: {
        language: 'typescript',
        code: `const lease = await lock.acquire('report', { ttlMs: 30_000 });
if (lease.remainingMs() > 5_000) {        // plenty of time left
  await storage.put('report.csv', data);  // object storage, no preconditions
}
await lease.release();`,
      },
      options: [
        'Nothing; the 5 s margin guarantees the write lands before expiry',
        'A pause (GC/VM) or network delay after the check can push the put past expiry while another holder writes; without a fencing token checked by storage, the stale write can overwrite the new one',
        'release() may throw, leaving the lock held forever',
        'remainingMs() uses a monotonic clock, so it is always wrong',
      ],
      correct: [1],
      explanation:
        'Any time-based check is check-then-act: the process can stall arbitrarily long after the check, or the request can sit in the network, so the write may land after the lease has expired and a new holder has written. Only a fencing token (or a conditional write on a version) enforced by the storage rejects the stale write. A throwing release is recoverable by TTL expiry, and monotonic clocks are the right tool for durations.',
      followUps: [
        {
          "q": "Object storage here has no preconditions. How do you make this write safe anyway?",
          "a": "Move the decision point to something that can compare. Write the report under a versioned key that includes the fencing token (`report.v{token}.csv`), then publish it by updating a pointer in a store with conditional writes (a DB row `UPDATE pointer SET key = $k, token = $t WHERE token < $t`). Readers follow the pointer, so a stale holder's late object is just garbage that's never referenced, and a lifecycle rule cleans it up. If the store supports `If-Match` on ETags, use a compare-and-swap directly."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-06',
      difficulty: 'hard',
      question:
        'Two datacenters host a 2+2 database cluster with an automatic failover rule: "if you can\'t reach the other DC for 10 s, promote a local primary." The inter-DC link fails. What happens?',
      options: [
        'The DC with the current primary keeps it; the other DC waits',
        'Neither DC promotes because a majority is required',
        'Both DCs promote a primary and accept conflicting writes — split brain',
        'The cluster automatically merges writes when the link heals',
      ],
      correct: [2],
      explanation:
        'The rule treats "unreachable" as "dead", so each side independently promotes and accepts writes — the definition of split brain. A majority requirement (with a third-site witness) would stop it, but this rule has none. Nothing merges conflicting relational writes automatically; recovery requires manual reconciliation.',
      followUps: [
        {
          "q": "You add a third-site witness. The witness is in DC-A's region and the inter-DC link fails. Which side keeps working, and what's the remaining risk?",
          "a": "DC-A has 2 nodes + witness = 3 of 5 votes, a majority, so it keeps or promotes the primary; DC-B can't reach a majority and stops accepting writes. The risk: the witness is correlated with DC-A, so a regional event that takes out DC-A and the witness leaves DC-B with 2 of 5 and no automatic failover. Put the witness in a truly independent third location, and ensure the old primary in DC-B fences itself when it loses quorum."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-07',
      difficulty: 'medium',
      question:
        'Why does Raft randomise election timeouts?',
      options: [
        'To reduce the chance that several followers become candidates simultaneously and split the vote repeatedly',
        'To make leaders rotate fairly among nodes',
        'To hide network latency from clients',
        'To prevent clock skew from affecting terms',
      ],
      correct: [0],
      explanation:
        'If all followers used the same timeout, they would all time out together after a leader failure, each vote for itself and split the vote, over and over. Randomisation makes one node usually time out first and win before others start. Raft doesn\'t aim for leader rotation, and terms are logical counters unaffected by clocks.',
      followUps: [
        {
          "q": "Your election timeout is randomised over 150–300 ms, but cross-region RTT is 120 ms. Elections keep failing with split votes. Why, and how do you tune it?",
          "a": "A candidate needs a full RequestVote round trip (plus fsync) to collect votes, about 120+ ms. If the randomisation window is close to that, a second follower often times out before the first one's votes arrive, splitting the vote. Raft's rule is broadcastTime ≪ electionTimeout ≪ MTBF. Use a base timeout around 10× RTT (e.g. 1–2 s) with a wide random range, and a heartbeat interval of roughly RTT to a few RTTs. Watch the elections-per-hour metric after tuning."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-08',
      difficulty: 'expert',
      question:
        'Which of the following act as fencing tokens (monotonic values that let a resource reject a stale leader)? Select ALL that apply.',
      options: [
        'Raft term numbers',
        'Kafka controller epoch / partition leader epoch',
        'etcd key mod_revision obtained when acquiring the lock key',
        'The lock holder\'s hostname',
        'A random UUID generated on lock acquisition',
      ],
      correct: [0, 1, 2],
      explanation:
        'A fencing token must increase with every new grant so a resource can compare "newer vs older": terms, epochs and etcd revisions all do. Hostnames repeat and carry no order; random UUIDs are unique but not ordered, so a resource can\'t tell which holder is newer.',
      followUps: [
        {
          "q": "Your resource is a third-party API that only accepts a string idempotency key, not a numeric token. Can you still get fencing?",
          "a": "Not true fencing — the API can't compare tokens, so it can't reject an older leader. What you can get is deduplication: derive the idempotency key from the work item, not from the leader (e.g. `invoice-{id}`), so two leaders performing the same operation collapse into one. That handles duplicates but not conflicting writes (a stale leader writing different data). For those, put a proxy or your own DB in front that checks the monotonic token before forwarding."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-09',
      difficulty: 'hard',
      question:
        'Given vector clocks for three events, which statements are true? Select ALL that apply.',
      code: {
        language: 'text',
        code: `e1 = {A:2, B:0, C:1}
e2 = {A:2, B:1, C:1}
e3 = {A:1, B:0, C:2}`,
      },
      options: [
        'e1 happened-before e2',
        'e1 and e3 are concurrent',
        'e3 happened-before e2',
        'e2 and e3 are concurrent',
      ],
      correct: [0, 1, 3],
      explanation:
        'e1 ≤ e2 element-wise and differs in B, so e1 → e2. e1 vs e3: e1 has A larger, e3 has C larger → concurrent. e3 vs e2: e3 has C:2 > e2\'s C:1, while e2 has A and B larger → neither dominates, so they are concurrent, not ordered. Lamport timestamps could never reveal this concurrency.',
      followUps: [
        {
          "q": "e2 and e3 are concurrent writes to the same shopping cart key. What should the store do on read, and what does the application do?",
          "a": "Keep both as siblings rather than picking one by timestamp. A read returns both values plus their merged context; the application resolves them — for a cart, union the item sets (with tombstones or an OR-Set CRDT so deletes survive) — and writes back the result with the merged vector {A:2, B:1, C:2}, which dominates both and replaces the siblings. LWW instead would silently drop one user's additions."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-10',
      difficulty: 'expert',
      question:
        'Lamport timestamps: event X has L = 12 and event Y has L = 15 (on different nodes). What can you conclude?',
      options: [
        'X happened-before Y',
        'Y happened-before X if Y\'s node has a lower node id',
        'X and Y are concurrent',
        'Y did not happen-before X; X may have caused Y or they may be concurrent',
      ],
      correct: [3],
      explanation:
        'Lamport clocks guarantee A → B ⇒ L(A) < L(B). By contraposition, L(Y) > L(X) rules out Y → X, but L(X) < L(Y) does not imply X → Y; they could be concurrent. Detecting concurrency requires vector clocks. Node ids only break ties between equal timestamps.',
      followUps: [
        {
          "q": "Two events both have L = 15 on different nodes. You need a total order for a replicated log. How do you break the tie, and is the resulting order meaningful?",
          "a": "Order by (L, nodeId): compare timestamps, then node ids. That gives a total order consistent with causality (if A → B then (L(A), id) < (L(B), id)), which is enough for things like Lamport's mutual exclusion or deterministic replay. But the order among concurrent events is arbitrary — node 1 always 'wins' ties — so it says nothing about real time or fairness. If you need real-time order between clients, you need a sequencer or synchronised clocks with bounds."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-11',
      difficulty: 'hard',
      question:
        'A service measures request timeouts with this code. After an NTP step adjustment of −2 s, some requests "time out" instantly and others never. Why?',
      code: {
        language: 'typescript',
        code: `const start = Date.now();
while (!done()) {
  if (Date.now() - start > 5_000) throw new Error('timeout');
  await tick();
}`,
      },
      options: [
        'Date.now() has millisecond resolution, too coarse for timeouts',
        'Wall-clock time can jump backwards or forwards; durations must use a monotonic clock like performance.now() or process.hrtime.bigint()',
        'The loop needs a setTimeout instead of polling',
        'NTP adjustments only affect UTC conversion, so the bug is elsewhere',
      ],
      correct: [1],
      explanation:
        'Date.now() follows the wall clock, which NTP (or an operator, or VM restore) can step. A backwards step makes the elapsed time negative (the timeout fires late or never); a forward step makes it huge (instant timeout). Monotonic clocks only move forward at a steady rate. Resolution and polling style are not the cause.',
      followUps: [
        {
          "q": "Where else does this bug class appear in a distributed system besides request timeouts?",
          "a": "Anywhere durations are computed from wall clocks: lease expiry checks, rate limiter windows, cache TTLs computed locally, retry backoff, heartbeat timeouts in failure detectors, and latency metrics. A forward clock step can make a leader think its lease expired (spurious failover); a backward step can make it think the lease is still valid (unsafe). Use monotonic clocks for local durations, and never compare one machine's wall clock to a timestamp generated by another machine as if they shared a clock."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-12',
      difficulty: 'expert',
      question:
        'Spanner reports TrueTime uncertainty ε = 5 ms. A read-write transaction picks commit timestamp s = TT.now().latest. Roughly how long does commit wait delay its visibility, and why?',
      options: [
        '~2ε ≈ 10 ms at most, until TT.now().earliest > s, so any transaction starting afterwards gets a larger timestamp',
        '~0 ms; TrueTime means clocks are perfectly synchronised',
        '~ε/2 ≈ 2.5 ms, the average clock error',
        'One cross-region round trip, to agree on the timestamp via Paxos',
      ],
      correct: [0],
      explanation:
        'The leader waits until it is certain real time has passed s: from s = latest, earliest must advance past s, which takes up to the interval width 2ε. This makes timestamp order match real-time order (external consistency). TrueTime bounds rather than eliminates uncertainty, and the Paxos round trip is a separate cost that commit wait overlaps with.',
      followUps: [
        {
          "q": "Running without atomic clocks, your NTP-based ε is 100 ms. What would commit wait cost, and how do systems like CockroachDB avoid paying it on every write?",
          "a": "Commit wait would be up to 2ε ≈ 200 ms per read-write transaction — unacceptable. CockroachDB instead assumes a maximum clock offset (default 500 ms) and moves the cost to reads: a read that encounters a value with a timestamp inside its uncertainty window restarts at a higher timestamp. Most reads see no such values, so the common path is cheap. It gives serializability plus no stale reads per key, but not Spanner's full external consistency across unrelated keys."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-13',
      difficulty: 'hard',
      question:
        'A Cassandra cluster in a cloud with noisy networking keeps marking healthy nodes down for a few seconds. Which changes are sensible? Select ALL that apply.',
      options: [
        'Raise phi_convict_threshold from 8 to around 10–12',
        'Investigate GC pauses and CPU steal on the nodes being convicted',
        'Lower phi_convict_threshold to 4 so recoveries are detected faster',
        'Separate gossip/heartbeat traffic from saturated interfaces or reduce streaming bandwidth',
      ],
      correct: [0, 1, 3],
      explanation:
        'Higher phi thresholds tolerate more variance in heartbeat arrival (commonly recommended on cloud networks); GC pauses, CPU steal and saturated links delay heartbeats and cause false convictions. Lowering the threshold makes the detector more aggressive, increasing false positives rather than helping recovery.',
      followUps: [
        {
          "q": "Raising phi_convict_threshold fixes false downs. What does it cost when a node really dies, and how do you keep reads fast during that window?",
          "a": "Detection gets slower: with a higher threshold, a genuinely dead node takes several more seconds to be marked down, and coordinators keep sending requests to it. Requests to it time out, inflating tail latency. Mitigate with speculative retry (`speculative_retry = 99p`) so the coordinator sends a redundant read to another replica if the first is slow, dynamic snitch scores that route around slow replicas, and client-side timeouts tuned below the SLO."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-14',
      difficulty: 'expert',
      question:
        'A ZooKeeper leader-election recipe has every candidate watch the /election node\'s children and re-check "am I the lowest?" on every change. With 2,000 candidates, what problem appears and what is the standard fix?',
      options: [
        'Split brain; fix by using persistent instead of ephemeral nodes',
        'Livelock between candidates; fix with randomised timeouts',
        'Herd effect: every change notifies all 2,000 clients who all re-list children; fix by having each candidate watch only its immediate predecessor sequential node',
        'Lost leadership on session expiry; fix by disabling session timeouts',
      ],
      correct: [2],
      explanation:
        'Watching the whole directory causes a thundering herd of notifications and getChildren calls on every join/leave. Watching only the next-lower sequential znode means exactly one client is notified when its predecessor disappears. Ephemeral nodes are essential (they vanish when a crashed leader\'s session expires), and disabling session expiry would leave dead leaders in place.',
      followUps: [
        {
          "q": "With predecessor watches, candidate #5's predecessor #4 dies, but #3 is still alive. What must #5 do, and why?",
          "a": "On the watch firing, #5 must re-list children and check whether it's now the lowest. It isn't (#3 is still there), so it sets a new watch on its new predecessor (#3) rather than claiming leadership. Assuming 'my predecessor died, so I'm the leader' is a classic bug: a non-leader in the middle of the queue can disappear (session expiry, crash) at any time. Only the lowest sequence number is leader, and leadership claims must re-verify."
        }
      ],
    },
    {
      id: 'ds-consensus-mcq-15',
      difficulty: 'hard',
      question:
        'This HLC update runs on message receive. What property does it guarantee that plain wall-clock timestamps do not?',
      code: {
        language: 'typescript',
        code: `update(remote) {
  const l = Math.max(this.l, remote.l, Date.now());
  this.c = (l === this.l && l === remote.l) ? Math.max(this.c, remote.c) + 1
         : l === this.l ? this.c + 1
         : l === remote.l ? remote.c + 1 : 0;
  this.l = l;
}`,
      },
      options: [
        'Timestamps equal true physical time exactly',
        'It removes the need for NTP entirely',
        'It detects concurrent events like a vector clock',
        'If event A causally precedes B (e.g. B happens after receiving A\'s message), then HLC(A) < HLC(B), while staying close to physical time',
      ],
      correct: [3],
      explanation:
        'Taking the max of local, remote and physical time plus a logical counter guarantees receive events are ordered after the send even if the receiver\'s clock is behind — the Lamport property — while l stays within the clock-skew bound of real time. It does not equal true time, cannot detect concurrency (single scalar), and still relies on NTP to keep l close to reality.',
      followUps: [
        {
          "q": "One node's clock jumps 1 hour ahead and it sends messages to everyone. What happens to the HLCs across the cluster, and how do you protect against it?",
          "a": "Every receiver takes the max, so its `l` jumps an hour ahead too, and it spreads through the cluster. Physical time can't catch up for an hour, so `l` stays pinned and only the counter `c` advances, making timestamps drift far from real time (bad for TTLs, follower reads and MVCC GC). Protect by rejecting or flagging remote timestamps more than a maximum offset ahead of local physical time (CockroachDB crashes a node whose offset exceeds the bound), and alert on clock offset."
        }
      ],
    },
  ],
};

export default topic;
