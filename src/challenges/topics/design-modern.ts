import type { ChallengeSet, Expr } from '../types';

// LLM serving tune: one 8 × 80 GB node, 70B model, 8K-token conversations
const B: Expr = { knob: 'B' };
const P: Expr = { knob: 'P' }; // KV KiB per token: 320 (fp16) or 160 (fp8)
const PAGED: Expr = { knob: 'paged' };
/** KV memory in GB: sequences × 8,192 tokens × KiB/token ÷ 1,048,576, ×3 when KV is pre-allocated for max_tokens */
const kvGb: Expr = {
  op: 'mul',
  args: [B, { op: 'div', args: [P, 128] }, { op: 'if', cond: { left: PAGED, op: '==', right: 1 }, then: 1, else: 3 }],
};

const set: ChallengeSet = {
  topic: 'design-modern',
  puzzles: [
    {
      mode: 'flow',
      id: 'ipl-live-pipeline',
      tab: 'IPL live stream',
      title: 'IPL final: from stadium feed to 60M screens',
      brief:
        'One production feed must reach 60M concurrent phones and TVs within 5–10 s glass-to-glass, survive a 5× surge at the toss, and the origin should see only tens of requests per second.',
      cols: 4,
      rows: 3,
      nodes: [
        { id: 'feed', label: 'Stadium feed', sub: 'contribution encoders', kind: 'terminal', col: 0, row: 0 },
        { id: 'ingest', answer: 'ingest', hint: 'Two paths, identical timestamps', col: 1, row: 0 },
        { id: 'transcode', answer: 'transcoder', hint: 'Encodes the ladder faster than real time', col: 2, row: 0 },
        { id: 'package', answer: 'packager', hint: 'Segments + playlists, DRM, ad markers', col: 3, row: 0 },
        { id: 'origin', label: 'Origin, 2 regions', sub: 'active-active + DVR', col: 3, row: 2 },
        { id: 'shield', answer: 'shield', hint: 'Turns 1,000s of misses into one fetch', col: 2, row: 2 },
        { id: 'cdn', answer: 'cdn', hint: 'Serves ~30M req/s near viewers', col: 1, row: 2 },
        { id: 'players', label: '60M players', sub: 'ABR, 4 s segments', kind: 'terminal', col: 0, row: 2 },
      ],
      edges: [
        ['feed', 'ingest', 'SRT ×2'],
        ['ingest', 'transcode'],
        ['transcode', 'package'],
        ['package', 'origin', 'CMAF'],
        ['origin', 'shield'],
        ['shield', 'cdn', 'one fetch'],
        ['cdn', 'players', 'segments'],
      ],
      options: [
        {
          id: 'ingest',
          label: 'Redundant ingest PoPs',
          sub: 'PoP A + PoP B',
          is: 'two contribution paths into two ingest PoPs with identical timestamps, so the packager can fail over without a discontinuity',
        },
        {
          id: 'transcoder',
          label: 'Live transcoder',
          sub: 'aligned 2 s GOPs',
          is: 'decode once, encode 1080p/720p/480p/360p in parallel with keyframes aligned, so players can switch rendition at any segment boundary',
        },
        {
          id: 'packager',
          label: 'Packager',
          sub: 'CMAF, HLS/DASH, DRM',
          is: 'the stage that cuts CMAF fragments, writes HLS and DASH playlists from the same media, and adds DRM and ad-insertion markers',
        },
        {
          id: 'shield',
          label: 'Shield / mid-tier cache',
          sub: 'request collapsing',
          is: 'a cache tier that collapses identical in-flight misses into one origin fetch, so the origin sees ~60 req/s whatever the audience',
        },
        {
          id: 'cdn',
          label: 'Multi-CDN + ISP caches',
          sub: 'steered per player',
          is: 'the edge that actually carries ~59 Tbps of egress, with players steered across CDNs and ISP-embedded caches',
        },
        {
          id: 'single',
          label: 'Single RTMP ingest box',
          sub: 'one path',
          decoy: true,
          is: 'a single point of failure on ingest: if that one box or link drops, 60M screens go black',
        },
        {
          id: 'webrtc',
          label: 'WebRTC SFU fan-out',
          sub: 'sub-second',
          decoy: true,
          is: 'per-viewer stateful servers that cost far more per viewer; reserved for interactive or betting use, not 60M passive viewers',
        },
      ],
      why: [
        'Two ingest paths with identical timestamps remove the single point of failure at the very start of the pipeline.',
        'Aligned GOPs across renditions are what make adaptive bitrate switching possible at every segment boundary.',
        'The shield tier collapses identical misses, so origin load stays at tens of requests per second however many people watch.',
        'The CDN is the system: 60M × ~1 Mbps ≈ 59 Tbps and ~30M edge requests/s, so size it first.',
      ],
    },
    {
      mode: 'route',
      id: 'docs-op-routing',
      tab: 'Route the doc traffic',
      title: 'Google Docs: send every message to the right place',
      brief:
        'Doc 42 is being edited by four people while 2,000 colleagues watch it during an all-hands. Steer each message so every replica converges, no acknowledged edit is lost, and the sequencer never sees the viewers.',
      cols: 5,
      rows: 3.3,
      nodes: [
        { id: 'editor', label: 'Editors', sub: 'WSS · doc 42', kind: 'terminal', col: 0, row: 0.3 },
        { id: 'viewer', label: 'Viewers', sub: '2,000 at the all-hands', kind: 'terminal', col: 0, row: 2.3 },
        { id: 'gw', label: 'WebSocket gateway', sub: 'hash(doc_id) ring', col: 1.3, row: 1.3 },
        { id: 'other', label: 'Collab server 3', sub: 'owns other docs', col: 2.7, row: 0.05 },
        { id: 'owner', label: 'Collab server 7', sub: 'lease: owns doc 42', col: 2.7, row: 1.3 },
        { id: 'fanout', label: 'Read fan-out tier', sub: 'relays committed ops', col: 2.7, row: 2.5 },
        { id: 'oplog', label: 'Op log', sub: 'PK (doc_id, rev)', col: 4, row: 0.6 },
        { id: 'peers', label: 'Co-editors’ sockets', sub: '3 others in doc 42', col: 4, row: 2 },
      ],
      edges: [
        ['editor', 'gw'],
        ['viewer', 'gw'],
        ['gw', 'other'],
        ['gw', 'owner'],
        ['gw', 'fanout'],
        ['owner', 'oplog', 'append'],
        ['owner', 'peers', 'broadcast'],
        ['owner', 'fanout', 'committed'],
      ],
      packets: [
        {
          id: 'op',
          label: 'Asha types “X” at position 1',
          sub: 'op · baseRev 5 · clientSeq 18',
          from: 'editor',
          paths: [['editor', 'gw', 'owner', 'oplog']],
          wrong: {
            'gw>other':
              'Collab server 3 doesn’t own doc 42. Two servers sequencing the same document would assign revisions independently, and the replicas would diverge.',
            'gw>fanout':
              'The fan-out tier is read-only: it relays ops that the owner has already committed. An edit has to be transformed and given a revision by the doc’s one sequencer.',
            'owner>peers':
              'Broadcasting before the durable append is premature. If the server crashed now, co-editors would have seen an edit that was never stored. The owner appends first, then acks and broadcasts.',
            'owner>fanout':
              'Nothing is committed yet. The op must first be transformed against the ops since rev 5 and appended to the log as the next revision.',
          },
          right: {
            'gw>owner': 'The gateway hashes doc_id, so every session of doc 42 lands on its owner, the single sequencer.',
          },
          done: 'The owner dedupes on (clientId, clientSeq), transforms the op against everything committed since rev 5, and inserts it as the next (doc_id, rev). Only then does it ack Asha and broadcast to the others.',
        },
        {
          id: 'cursor',
          label: 'Ravi moves his cursor to position 120',
          sub: 'presence · ~10 updates/s',
          from: 'editor',
          paths: [['editor', 'gw', 'owner', 'peers']],
          wrong: {
            'gw>other': 'Presence rides on the same socket as the edits, and that socket is attached to doc 42’s owner, not to server 3.',
            'gw>fanout': 'The fan-out tier only relays committed ops to viewers. A cursor is an ephemeral update for the people editing.',
            'owner>oplog':
              'Presence is never persisted. Writing ~10 cursor updates per second per user to the op log would bloat history with data that is useless a second later.',
            'owner>fanout': 'The fan-out tier carries committed ops, and a cursor position isn’t one. Presence goes only to the live co-editors.',
          },
          done: 'Presence goes straight to the other editors: throttled, last value wins, expired on heartbeat loss, and transformed against incoming ops so it doesn’t drift.',
        },
        {
          id: 'viewer-open',
          label: 'A viewer opens the all-hands doc',
          sub: 'read-only session',
          from: 'viewer',
          paths: [['viewer', 'gw', 'fanout']],
          wrong: {
            'gw>owner':
              '2,000 viewer sockets on the sequencer would compete with the four people actually editing. The owner should never be in the viewers’ path.',
            'gw>other': 'Server 3 doesn’t own doc 42 and has no stream of its committed ops to give a viewer.',
          },
          done: 'Viewers subscribe to the read-only fan-out tier, which relays ops after the owner commits them. The sequencer only serves the editors.',
        },
      ],
      why: [
        'One owner per document: the gateway hashes doc_id and an ownership lease makes that server the single sequencer.',
        'An edit is transformed and appended as (doc_id, rev) before the ack and the broadcast, so no acknowledged edit is ever lost.',
        'Presence is ephemeral: sent over the same socket, throttled, never persisted.',
        'Large audiences read from a fan-out tier of committed ops and never touch the sequencer.',
      ],
    },
    {
      mode: 'fault',
      id: 'zoom-broken-call',
      tab: 'Video call outage',
      title: 'Group calls are stuttering and failing to join',
      brief:
        '10-person team calls: laptops upload over 13 Mbps and fans spin, people on corporate Wi-Fi never get media, and phones on weak links freeze while everyone else is fine. Find the three wrong pieces.',
      cols: 4.6,
      rows: 3,
      nodes: [
        { id: 'people', label: '10 participants', sub: 'browser + mobile', kind: 'terminal', col: 0, row: 1.1 },
        {
          id: 'signal',
          label: 'Signaling service',
          sub: 'WSS: SDP, ICE, mute',
          col: 1,
          row: 0,
          fine: 'Signaling is a low-bandwidth control plane: join, offer/answer and candidates all arrive. Media never flows through it.',
        },
        {
          id: 'room',
          label: 'Room state',
          sub: 'memory + Redis copy',
          col: 2.6,
          row: 0,
          fine: 'Participants, tracks and the assigned SFU are kept in memory with a Redis copy for failover. Joins are recorded correctly.',
        },
        {
          id: 'ice',
          label: 'ICE servers',
          sub: 'STUN only',
          col: 1,
          row: 2,
          fault: {
            answer: 'turn',
            clue: 'A relay that works when UDP is blocked',
            why: 'STUN only discovers a public address. On UDP-blocked corporate networks no candidate pair ever works, so those users join but never get media.',
          },
        },
        {
          id: 'enc',
          label: 'Publisher encoder',
          sub: 'one 720p stream',
          col: 1,
          row: 1,
          fault: {
            answer: 'simulcast',
            clue: 'Give the server layers to choose from',
            why: 'With a single 720p layer there is nothing smaller to forward, so a subscriber on a weak link gets the full stream or nothing and freezes.',
          },
        },
        {
          id: 'topo',
          label: 'Media routing',
          sub: 'full mesh, N−1 uploads',
          col: 2.6,
          row: 1,
          fault: {
            answer: 'sfu',
            clue: 'Upload once, server forwards',
            why: 'In a mesh every client uploads to every other: 9 × 1.5 = 13.5 Mbps per laptop. Mesh dies past about 4–5 people.',
          },
        },
        {
          id: 'rec',
          label: 'Recorder bot',
          sub: 'hidden subscriber',
          col: 3.9,
          row: 1,
          fine: 'The recorder joins as a hidden subscriber and stores each track separately: cheaper than recording through an MCU, and not on the live path.',
        },
      ],
      edges: [
        ['people', 'signal', 'WSS'],
        ['people', 'enc'],
        ['people', 'ice', 'candidates'],
        ['signal', 'room'],
        ['enc', 'topo', 'SRTP'],
        ['topo', 'rec'],
      ],
      options: [
        {
          id: 'sfu',
          label: 'SFU',
          sub: 'forwards, no transcoding',
          is: 'a selective forwarding unit: each client uploads once and the server forwards packets in ~1–5 ms without decoding',
        },
        {
          id: 'turn',
          label: 'STUN + TURN over TLS 443',
          sub: 'relay as last resort',
          is: 'adding a relay that works on port 443 when UDP is blocked, used only when direct candidates fail',
        },
        {
          id: 'simulcast',
          label: 'Simulcast 720/\u200B360/\u200B180p',
          sub: '2.15 Mbps upload',
          is: 'three independent layers per publisher, so the SFU can forward a smaller one to each weak subscriber without transcoding',
        },
        {
          id: 'mcu',
          label: 'MCU: decode + mix',
          sub: 'one composite stream',
          decoy: true,
          is: 'a mixer that decodes and re-encodes every stream: CPU-heavy and +100–200 ms, which breaks the ~150 ms budget',
        },
        {
          id: 'alwaysrelay',
          label: 'Relay every call via TURN',
          sub: 'force relay',
          decoy: true,
          is: 'relaying every packet for everyone, which costs real bandwidth when most clients could reach the SFU directly',
        },
        {
          id: 'transcode',
          label: 'SFU transcodes per viewer',
          sub: 're-encode on demand',
          decoy: true,
          is: 'turning the forwarder back into a mixer: decoding and re-encoding per subscriber burns CPU and adds latency',
        },
      ],
      metrics: [
        { label: 'Upload per laptop', bad: 13.5, good: 2.15, unit: ' Mbps', decimals: 2, fixedBy: ['topo'] },
        { label: 'Corp Wi-Fi no media', bad: 18, good: 0, unit: '%', fixedBy: ['ice'] },
        { label: 'Weak-link freezes', bad: 42, good: 1, unit: '/h', fixedBy: ['enc'] },
      ],
      why: [
        'SFU by default: each client uploads once (1.5 + 0.5 + 0.15 = 2.15 Mbps with simulcast) instead of N−1 streams.',
        'Simulcast or SVC lets the SFU pick a layer per subscriber from bandwidth estimates, switching only on keyframes.',
        'ICE tries host, then STUN, then TURN; TURN over TLS 443 is the last resort that always works on locked-down networks.',
        'MCU-style mixing belongs only at the edges (PSTN, legacy rooms), where a device can decode just one stream.',
      ],
    },
    {
      mode: 'spike',
      id: 'ipl-toss-surge',
      tab: 'Survive the toss',
      title: 'IPL final: survive the 5× surge at the toss',
      brief:
        'The audience goes from 12M to 60M in the minutes around the toss, taking edge requests from 6M to 30M per second. In this scenario the app APIs handle 600K calls/s and the CDN contract is 55 Tbps. You can make two changes before the toss.',
      cols: 4,
      rows: 2.2,
      nodes: [
        { id: 'fans', label: 'Phones + TVs', sub: '2 edge req per 4 s', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'api', label: 'App APIs', sub: 'login, home, trays', col: 1.5, row: 0.05, share: 0.05, capacity: 600000, unit: 'calls/s', ms: 40 },
        { id: 'cdn', label: 'CDN egress', sub: '~1 Mbps per viewer', col: 2.9, row: 1.15, share: 0.00000197, capacity: 55, unit: 'Tbps', ms: 0 },
      ],
      edges: [
        ['fans', 'api', 'API calls'],
        ['fans', 'cdn', 'segments'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 6000000],
        [8, 6000000],
        [24, 30000000],
        [60, 30000000],
      ],
      maxCards: 2,
      cards: [
        {
          id: 'prewarm',
          label: 'Pre-warm to the ladder',
          sub: '3× pods before the toss',
          node: 'api',
          effects: [{ node: 'api', capacity: 3 }],
          is: 'scaling ahead of demand to a concurrency ladder forecast from the fixture, so the pods are already booted when the surge lands',
        },
        {
          id: 'panic',
          label: 'Panic mode flags',
          sub: 'trays, recos off',
          node: 'api',
          effects: [{ node: 'api', load: 0.35 }],
          is: 'switching off recommendations, personalised trays and other non-critical APIs so login, entitlement and playback keep working',
        },
        {
          id: 'cap-rendition',
          label: 'Cap the top rendition',
          sub: '1080p → 720p for now',
          node: 'cdn',
          effects: [{ node: 'cdn', load: 0.874 }],
          is: 'degrading quality before availability: the 5% on 1080p drop from 4.5 to 2 Mbps, so the average falls from ~0.99 to ~0.87 Mbps',
        },
        {
          id: 'cpu-autoscale',
          label: 'Autoscale on CPU',
          sub: 'reactive, 70% target',
          node: 'api',
          decoy: true,
          effects: [],
          is: 'reactive scaling on a lagging signal: with ~1 min app boot time, step sizes and cooldowns, new pods arrive after the surge has already hit',
        },
        {
          id: 'short-segments',
          label: 'Switch to 2 s segments',
          sub: 'lower latency',
          node: 'cdn',
          decoy: true,
          effects: [{ node: 'cdn', load: 1.1 }],
          is: 'a latency feature at the worst moment: 3× the request rate and worse compression, so egress rises when the CDN is tightest',
        },
      ],
      goals: [
        { metric: 'util:api', max: 100, label: 'App APIs ≤ 100% busy', fail: 'The app APIs are saturated, so logins and entitlement checks time out and people can’t start the stream.' },
        { metric: 'util:cdn', max: 100, label: 'Egress ≤ CDN contract', fail: 'Egress is past what the CDN can deliver, so players rebuffer and drop to the lowest quality or stall.' },
      ],
      why: [
        'Reactive autoscaling is too slow for 1M+ new viewers a minute: pre-warm to a forecast ladder and scale on concurrency, not CPU.',
        'Panic mode sheds non-critical features so that login, entitlement and playback stay up.',
        'Degrade quality before availability: capping the top rendition cuts egress without dropping anyone.',
        'The CDN is the system: 60M × ~1 Mbps ≈ 59 Tbps, so every Mbps per viewer matters at the peak.',
      ],
    },
    {
      mode: 'tune',
      id: 'llm-kv-budget',
      tab: 'LLM GPU node',
      title: 'Fit 8K-token chats on one GPU node',
      brief:
        'A 70B model on 8 × 80 GB GPUs leaves ~440 GB for the KV cache. The product now promises 8K-token conversations, and 6M output tokens/s at 50 tok/s per stream must fit in a 400-node fleet.',
      cols: 3.6,
      rows: 3,
      nodes: [
        { id: 'clients', label: 'Chat clients', sub: 'SSE token stream', kind: 'terminal', col: 0, row: 1 },
        { id: 'router', label: 'Router', sub: 'prefix hash, free KV', col: 1.2, row: 1 },
        { id: 'gpu', label: 'GPU node · {B} streams', sub: '8 × 80 GB, 140 GB weights', col: 2.6, row: 0 },
        { id: 'kv', label: 'KV cache · {P} KiB/token', sub: '~440 GB budget', col: 2.6, row: 2 },
      ],
      edges: [
        ['clients', 'router', 'POST'],
        ['router', 'gpu', 'batch'],
        ['gpu', 'kv', 'per step'],
      ],
      knobs: [
        {
          id: 'P',
          label: 'KV precision',
          kind: 'choice',
          initial: 320,
          choices: [
            { value: 320, label: 'fp16' },
            { value: 160, label: 'fp8' },
          ],
          help: 'KiB of KV cache per token',
        },
        { id: 'paged', label: 'PagedAttention', kind: 'toggle', initial: 0, help: 'off: KV reserved for max_tokens (~2/3 wasted)' },
        { id: 'B', label: 'Concurrent sequences', kind: 'slider', min: 50, max: 500, step: 50, initial: 100, help: 'continuous batch size per node' },
      ],
      constraints: [
        {
          id: 'kv-fits',
          label: 'KV cache fits in 440 GB',
          left: kvGb,
          op: '<=',
          right: 440,
          unit: ' GB',
          hint: 'KV per sequence = 8,192 tokens × KiB per token. What halves it, and what stops the waste?',
          fail: 'The batch needs more KV memory than the node has: requests queue or get evicted, and the GPU cannot run this many sequences.',
          pass: 'Every running sequence has its KV blocks in memory, so the whole batch decodes each step.',
        },
        {
          id: 'fleet',
          label: 'Fleet ≤ 400 nodes',
          left: { op: 'fn', fn: 'ceil', args: [{ op: 'div', args: [6000000, { op: 'mul', args: [B, 50] }] }] },
          op: '<=',
          right: 400,
          unit: ' nodes',
          hint: 'Each stream makes 50 tokens/s, so a node makes sequences × 50. How many nodes for 6M tokens/s?',
          fail: 'Too few sequences per node: the fleet needed for 6M tokens/s blows the 400-node budget.',
          pass: 'Enough sequences per node: each decode step reads the weights once for the whole batch, so throughput scales almost for free.',
        },
      ],
      why: [
        'KV per token = 2 × layers × KV heads × head_dim × bytes: 320 KiB in fp16, so an 8K conversation needs 2.5 GB, and fp8 halves it.',
        'Pre-allocating KV for max_tokens wasted 60–80% of memory; PagedAttention stores KV in small blocks with under 4% waste.',
        'Decode is memory-bandwidth bound and reads the weights once per step regardless of batch size, so bigger batches are nearly free throughput.',
        'KV memory, not FLOPs, caps concurrency: fp8 + paging + ~350 sequences gives ~343 nodes, the same scale as the lesson estimate.',
      ],
    },
  ],
};

export default set;
