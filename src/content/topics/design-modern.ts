import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-modern',
  phase: 'designs',
  order: 8,
  title: 'Real-time, Media & AI: Live Streaming (Hotstar/Twitch), Video Conferencing (Zoom/Meet), ChatGPT-style LLM Service & Google Docs',
  subtitle:
    'Four designs interviewers added to their rotation in 2024–2026: one-to-50-million video fan-out, sub-150 ms group calls, GPU-bound token streaming, and convergent real-time co-editing.',
  estimatedMinutes: 170,
  sources: [
    'Hello Interview — Problem Breakdowns: ChatGPT, Google Docs, FB Live Comments (2025)',
    'Hotstar Engineering — Scaling Hotstar.com for 25 million concurrent viewers (Rootconf / AWS re:Invent 2019, CMY302)',
    'Disney+ Hotstar — 5.9 crore peak concurrency, ICC World Cup 2023 final (exchange4media, Nov 2023)',
    'Apple — HTTP Live Streaming 2nd Edition / Low-Latency HLS (RFC 8216bis)',
    'W3C/IETF — WebRTC 1.0, ICE (RFC 8445), TURN (RFC 8656), Transport-wide Congestion Control; Jitsi — Last N & simulcast',
    'Kwon et al. — Efficient Memory Management for LLM Serving with PagedAttention (vLLM, SOSP 2023); Yu et al. — Orca: iteration-level scheduling (OSDI 2022)',
    'Ellis & Gibbs — Concurrency Control in Groupware Systems (OT, 1989); Google Wave OT whitepaper; Shapiro et al. — CRDTs (2011); Yjs / Automerge docs',
    'techinterview.org & DesignGurus — Zoom, Twitch, Google Docs and AI system design interview guides (2025–2026)',
  ],
  tags: [
    'live-streaming',
    'hls',
    'll-hls',
    'cdn',
    'live-comments',
    'webrtc',
    'sfu',
    'simulcast',
    'turn',
    'llm-serving',
    'continuous-batching',
    'kv-cache',
    'sse',
    'token-rate-limiting',
    'collaborative-editing',
    'operational-transformation',
    'crdt',
    'presence',
  ],
  cheatSheet: [
    'Live streaming = few streams, enormous fan-out: Hotstar hit 25.3M concurrent (2019, ~10 Tbps) and 5.9 crore (59M) for the 2023 WC final. The CDN is the system; the origin should see only tens of requests per second thanks to shield-tier request collapsing.',
    'Live latency ≈ encode + segment duration × segments buffered + CDN. Classic HLS (6 s × 3) is 20–30 s; LL-HLS partial segments (0.2–1 s parts, blocking playlist reload) give 2–5 s; sub-second needs WebRTC fan-out, which costs far more per viewer.',
    'Spiky live events: pre-warm to a forecast concurrency ladder (Hotstar saw 1M+ joins/min with ~90 s to react), keep a "panic mode" that sheds recommendations/personalisation, and cap default bitrate before you shed viewers.',
    'Live comments/reactions at 10M viewers: aggregate reactions into per-second counts, sample/rank comments per viewer (nobody reads 50K/s), fan out stream → gateway (not per viewer) over SSE.',
    'Conferencing topologies: mesh uploads N−1 streams (dies past ~4–5 people); MCU decodes+mixes (CPU-heavy, adds latency, good for legacy/PSTN legs); SFU forwards without transcoding (the default for Zoom, Meet, Teams-class products).',
    'SFU toolkit: simulcast/SVC layers per publisher, per-subscriber layer selection from bandwidth estimates (transport-cc/GCC), switch only on keyframes, Last-N video for big rooms, audio always first. TURN over TLS 443 for UDP-blocked networks.',
    'LLM serving: prefill is compute-bound, decode is memory-bandwidth-bound (one token per step). Continuous (iteration-level) batching + PagedAttention KV blocks are what make a GPU pay for itself.',
    'KV cache per token = 2 (K,V) × layers × KV heads × head_dim × bytes. A 70B GQA model (80 × 8 × 128, fp16) needs 320 KiB/token → 1.25 GiB per 4K-token conversation; KV memory, not FLOPs, caps concurrency.',
    'LLM API path: POST → SSE token stream; generation decoupled from the socket (per-message stream buffer) so reloads resume; rate-limit on tokens by reserving prompt + max_tokens up front and refunding the unused part.',
    'Google Docs: one sequencer per document assigns revisions; clients send ops with baseRev, server transforms against ops since baseRev (OT) — or use CRDTs (Yjs/Automerge) for offline/P2P at a metadata cost. Presence is ephemeral and throttled; the op log is compacted into snapshots.',
  ],
  sections: [
    // ---------------- LIVE STREAMING ----------------
    {
      heading: 'Live streaming at IPL scale (1/3): requirements, estimation & how it differs from VOD',
      body: `**Intuition:** YouTube/Netflix is a library: millions of titles, each watched a little. A cricket final is a **single loudspeaker in a stadium of 50 million**: one production feed, a handful of renditions, and every viewer asking for the *same* 4-second chunk within the same few seconds. The design problem is fan-out and spikes, not storage.

**Functional (clarify first):**
- Broadcaster ingests one feed per language/camera (IPL ships ~10+ language feeds); viewers watch with adaptive bitrate (ABR).
- DVR window (pause / rewind ~30–60 min), "go live" button.
- Live comments + reactions, score overlay, server-side ad insertion (SSAI) at over breaks.
- Out of scope unless asked: VOD highlights pipeline (covered by the YouTube design), payments.

**Non-functional:** glass-to-glass latency 5–10 s (sports betting/fantasy overlays push for < 5 s), startup < 2 s, rebuffer ratio < 0.5%, 50M+ concurrency, survive a **5× surge in minutes** (toss, a star walking out to bat), no single point of failure on ingest.

**Estimation (assumption: 60M concurrent, India-heavy mobile mix):**

| Rendition | Share | Bitrate |
|---|---|---|
| 360p mobile | 45% | 0.4 Mbps |
| 480p | 35% | 0.8 Mbps |
| 720p | 15% | 2 Mbps |
| 1080p TV | 5% | 4.5 Mbps |

- Weighted average ≈ 0.18 + 0.28 + 0.30 + 0.225 ≈ **0.99 Mbps** → 60M × ~1 Mbps ≈ **59 Tbps** egress. (Sanity check: Hotstar reported **10 Tbps+ for 25.3M** viewers in 2019, i.e. ~0.4 Mbps average — mobile-first audiences drag the mean down.)
- Requests: 4 s segments + a playlist refresh per segment → 60M × 2 ÷ 4 = **30M req/s at the edge**.
- Origin: 6 renditions × 2 objects per 4 s × 20 shield nodes ≈ **60 req/s**. If the origin sees more than that, request collapsing is broken.

**Live vs VOD vs Twitch:**

| | IPL final (Hotstar/JioCinema) | Twitch | VOD (Netflix) |
|---|---|---|---|
| Streams | few, premium | ~100K concurrent channels, long tail | millions of titles |
| Bottleneck | CDN egress + spike absorption | transcode cost (only popular channels get full ABR ladders) | storage + CDN pre-positioning |
| Latency target | 5–10 s | 2–5 s (chat interactivity) | n/a |

**Say in interviews:** "This is a fan-out problem with a hard deadline: I size the CDN first, then make sure the origin is protected, then design for the spike."`,
      keyPoints: [
        '60M × ~1 Mbps ≈ 59 Tbps; ~30M edge req/s; origin should see ~tens of req/s.',
        'Few streams, huge audience: CDN egress and spike absorption dominate.',
        'Twitch inverts the problem: many small streams → transcode cost dominates.',
      ],
      source: 'Hotstar Engineering — Scaling Hotstar.com for 25M concurrent viewers (2019); Disney+ Hotstar 59M peak (2023)',
    },
    {
      heading: 'Live streaming (2/3): API, data model and the ingest → transcode → package → CDN pipeline',
      body: `**API surface (small on purpose):**
- \`POST /v1/streams\` → \`{ streamId, ingestUrls: [primary, backup], streamKey }\` (broadcaster control plane).
- Ingest: \`srt://ingest-a.example.com:9000?streamid=<key>\` (SRT preferred for contribution: UDP + retransmission over lossy links; RTMP still common).
- Playback: \`GET /live/{streamId}/master.m3u8\` with a short-lived signed token → rendition playlists → CMAF segments (\`.m4s\`) served by the CDN.
- Interaction: \`POST /v1/streams/{id}/comments\`, \`POST /v1/streams/{id}/reactions\`, \`GET /v1/streams/{id}/events\` (SSE: comments, reaction counts, score).
- Playback heartbeat every 30–60 s → concurrency dashboard + entitlement check (stop shared accounts).

**Data model:**
- \`streams(stream_id, event_id, language, state, ladder_json, ingest_primary, ingest_backup, started_at)\` — Postgres, tiny.
- Segments are objects: \`/{streamId}/{rendition}/{seq}.m4s\` in the origin cache + object store (DVR window, later VOD).
- Viewer concurrency: heartbeats → Kafka → per-minute HyperLogLog per stream (approximate unique viewers is fine).

**Pipeline:**
1. **Redundant ingest:** two contribution paths to two ingest PoPs with identical timestamps so the packager can fail over without a discontinuity.
2. **Live transcoder:** decode once, encode the ladder in parallel (GPU/ASIC encoders); GOPs aligned across renditions (keyframe every 2 s) so players can switch at any segment boundary. Must run faster than real time — a 4 s segment must finish encoding in < 4 s.
3. **Packager:** CMAF fragments + HLS and DASH manifests from the same media, DRM (Widevine/FairPlay), SSAI markers.
4. **Origin (2 regions, active-active)** → **shield tier** (collapses N identical misses into one) → **multi-CDN + ISP-embedded caches** → players with CDN steering.`,
      diagram: `  Stadium production --SDI--> contribution encoders (x2)
        | SRT (primary)            | SRT (backup)
        v                          v
  [Ingest PoP A]             [Ingest PoP B]
        \\                         /
         v                       v
   [Live transcoder: 1080p/720p/480p/360p, aligned 2 s GOPs]
                     |
                     v
   [Packager: CMAF + HLS/DASH playlists, DRM, ad markers]
                     |
          +----------+-----------+
          v                      v
   [Origin region 1]      [Origin region 2]   (+ object store: DVR)
          \\                     /
           v                   v
      [Shield / mid-tier caches: request collapsing]
          |            |               |
       [CDN A]      [CDN B]     [ISP-embedded caches]
           \\           |              /
            +--- players: ABR + multi-CDN steering ---+`,
      code: [
        {
          language: 'typescript',
          title: 'Live media playlist: sliding window + cache headers that keep viewers at the live edge',
          code: `interface Segment { seq: number; durationSec: number; uri: string }

const TARGET_DURATION = 4;  // seconds, must be >= every segment duration
const WINDOW = 6;           // segments advertised in the live playlist

export function renderLivePlaylist(segments: Segment[]): string {
  const live = segments.slice(-WINDOW);  // only the newest N segments
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:' + TARGET_DURATION,
    // players use MEDIA-SEQUENCE to know which segments they already have
    '#EXT-X-MEDIA-SEQUENCE:' + (live[0]?.seq ?? 0),
  ];
  for (const s of live) {
    lines.push('#EXTINF:' + s.durationSec.toFixed(3) + ',', s.uri);
  }
  return lines.join('\\n') + '\\n';  // no ENDLIST: the stream is still live
}

// Playlists change every segment; segments never change once written.
export function cacheHeadersFor(path: string): Record<string, string> {
  if (path.endsWith('.m3u8')) {
    // at most ~half a segment stale; shield collapses the refreshes
    return { 'Cache-Control': 'public, max-age=1, stale-while-revalidate=1' };
  }
  // segments are immutable: cache everywhere for the DVR window
  return { 'Cache-Control': 'public, max-age=86400, immutable' };
}`,
        },
      ],
      keyPoints: [
        'Two ingest paths with identical timestamps → seamless failover.',
        'Aligned GOPs across renditions make ABR switching possible.',
        'Playlists: ~1 s TTL; segments: immutable, long TTL.',
      ],
      source: 'Apple — HTTP Live Streaming (RFC 8216) and LL-HLS spec',
    },
    {
      heading: 'Live streaming (3/3): latency, origin protection, surviving the toss, and live comments',
      body: `**1. Latency budget.** Glass-to-glass ≈ capture/encode (1–2 s) + packaging + CDN (~0.5 s) + **player buffer**. With 6 s segments and a player that starts 3 segments behind the live edge you are at 20–30 s. Options:

| Technique | Typical latency | Cost |
|---|---|---|
| Classic HLS/DASH, 6 s segments | 20–30 s | cheapest, most robust |
| Short segments (2 s) | 8–12 s | 3× request rate, worse compression |
| **LL-HLS / LL-DASH** (0.2–1 s parts, blocking playlist reload, preload hints) | 2–5 s | CDN must support holding requests |
| WebRTC fan-out (SFU trees) | < 1 s | per-viewer stateful servers; reserved for interactive/betting use |

**2. Origin protection.** When segment N+1 appears, thousands of edge servers miss at once. The **shield tier collapses** identical in-flight misses into one origin fetch (Nginx \`proxy_cache_lock\`, CDN "collapsed forwarding"). Never let a CDN cache a 404 for a not-yet-published segment for long; publish a segment in the playlist only after it is fully written.

**3. Surviving the spike.** Hotstar's 2019 talk is the canonical reference: 1M+ new viewers per minute, ~1 min app boot time, so reactive autoscaling (step sizes, cooldowns, capacity errors) was too slow. What works:
- **Pre-warm** to a concurrency **ladder** forecast from the fixture (India match > others; finals > league) before the toss, using diversified instance types.
- Scale on **concurrency**, a leading signal, not CPU.
- **Panic mode:** flags that turn off recommendations, personalised trays and non-critical APIs so login, entitlement and playback stay up.
- **Degrade quality before availability:** cap the top rendition or start bitrate for new sessions to cut egress.
- Game days with synthetic load before the season (Hotstar's "Project HULK").

**4. Live comments and reactions.** At 10M viewers, ~0.5% reacting per second is 50K reactions/s per stream. Pushing each to every viewer is 5 × 10^11 messages/s, which is impossible. Instead:
- **Reactions** are aggregated per stream per second at ingestion shards; one summary event per second is broadcast.
- **Comments** go into Kafka partitioned by stream; a ranking/sampling tier picks ~5–10 per second (friends first, then quality score) to show each viewer.
- **Fan-out is stream → gateway, not stream → viewer:** each SSE gateway subscribes once per stream it has viewers for and multiplexes locally.`,
      code: [
        {
          language: 'typescript',
          title: 'Reaction aggregator: per-second counts instead of per-reaction fan-out',
          code: `import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
// streamId -> (emoji -> count) for the current 1 s window, in process memory
const window = new Map<string, Map<string, number>>();

export function onReaction(streamId: string, emoji: string): void {
  let counts = window.get(streamId);
  if (!counts) window.set(streamId, (counts = new Map()));
  counts.set(emoji, (counts.get(emoji) ?? 0) + 1);  // O(1), no I/O per reaction
}

// Every second each ingestion shard publishes ONE message per active stream.
setInterval(async () => {
  const snapshot = new Map(window);
  window.clear();
  const pipe = redis.pipeline();
  for (const [streamId, counts] of snapshot) {
    pipe.publish(
      'reactions:' + streamId,
      JSON.stringify({ ts: Date.now(), counts: Object.fromEntries(counts) }),
    );
  }
  await pipe.exec();  // gateways merge partial counts from all shards
}, 1000);`,
        },
      ],
      keyPoints: [
        'LL-HLS parts + blocking reload get 2–5 s without WebRTC costs.',
        'Shield-tier request collapsing keeps origin load flat regardless of audience.',
        'Pre-warm on a concurrency ladder; panic mode sheds non-critical features.',
        'Aggregate reactions, sample comments, fan out per gateway.',
      ],
      source: 'Hotstar — Scaling for 25M concurrent viewers (2019); Hello Interview — FB Live Comments',
    },
    // ---------------- VIDEO CONFERENCING ----------------
    {
      heading: 'Video conferencing (Zoom/Meet) (1/3): requirements, estimation & mesh vs MCU vs SFU',
      body: `**Intuition:** live streaming is one speaker and a stadium. A meeting is **a dinner table where everyone talks**: every participant is both a publisher and a subscriber, and the budget is about 150 ms mouth-to-ear (ITU-T G.114's comfort limit for one-way delay). Above ~300–400 ms people start talking over each other.

**Functional:** create/join meetings (link + waiting room), audio/video/screen-share, mute/kick, in-meeting chat, active-speaker and gallery views, recording, dial-in. Large webinars (1,000+) switch to a broadcast mode, which is really live streaming.

**Non-functional:** one-way latency < 150 ms in-region and < 300 ms cross-continent; **audio beats video** (degrade video first); works behind NAT and corporate firewalls; join < 3 s; regional data residency for enterprise.

**Topologies (10-person call, 1.5 Mbps per HD stream):**

| | Mesh (P2P) | MCU | SFU |
|---|---|---|---|
| Each client uploads | 9 × 1.5 = **13.5 Mbps** | 1 stream | 1 stream (+ simulcast layers) |
| Each client downloads | 9 streams | 1 composited stream | k streams it chose |
| Server CPU | none | **decode + mix + re-encode** every stream | packet routing only |
| Added latency | lowest | +100–200 ms (encode) | ~1–5 ms forwarding |
| Use | 1:1 calls | legacy room systems, PSTN, recording composition | default for groups |

**Estimation (100K concurrent meetings × 10 participants):**
- Upload per participant with 3-layer simulcast: 1.5 + 0.5 + 0.15 = **2.15 Mbps**.
- Download: 1 HD speaker (1.5) + 8 thumbnails × 0.15 (1.2) + 3 audio streams × 40 kbps (0.12) = **2.82 Mbps**.
- SFU egress per meeting = 10 × 2.82 ≈ 28 Mbps; fleet egress = 100K × 28.2 Mbps ≈ **2.8 Tbps**.
- At ~6 Gbps usable egress per SFU box → 2.82 Tbps ÷ 6 Gbps ≈ **470 SFUs** plus headroom and per-region spread.

**Say in interviews:** "SFU by default, P2P for 1:1 with fallback to the SFU, MCU-style mixing only at the edges where a device can decode just one stream."`,
      keyPoints: [
        'Budget: ~150 ms one-way; audio before video.',
        'Mesh uplink grows with N−1; SFU keeps uplink constant; MCU burns CPU.',
        '100K meetings × 10 people ≈ 2.8 Tbps SFU egress ≈ ~470 SFUs at 6 Gbps.',
      ],
      source: 'ITU-T G.114; W3C WebRTC 1.0; techinterview.org — Design Zoom (2026)',
    },
    {
      heading: 'Video conferencing (2/3): signaling API, NAT traversal and the meeting architecture',
      body: `**Two planes:**
- **Signaling (control plane):** a WebSocket to a meeting service. Messages: \`join\`, \`offer/answer\` (SDP), \`ice-candidate\`, \`mute\`, \`layout\`, \`leave\`. It is stateful per meeting but low-bandwidth.
- **Media (data plane):** SRTP over UDP between each client and its SFU, encrypted with DTLS-SRTP keys. The SFU never needs to decode.

**REST API:** \`POST /v1/meetings\` (schedule; returns join URL), \`POST /v1/meetings/{id}/join\` → \`{ signalingUrl, sfuRegion, iceServers, token }\`, \`POST /v1/meetings/{id}/recordings\`.

**Data model:** \`meetings(id, host_id, starts_at, settings_json, region_pin)\` in Postgres; **live room state** (participants, tracks, assigned SFU, who is speaking) in memory on the meeting service with a Redis copy for failover; \`recordings(meeting_id, track_id, object_key)\`.

**NAT traversal (ICE):** clients gather candidates: host addresses, **STUN** server-reflexive (public IP:port seen by STUN) and **TURN** relayed addresses. ICE tries pairs and picks the best one that works. STUN is cheap; TURN relays every packet and costs real bandwidth. For UDP-blocked enterprise networks, TURN over **TLS on 443** (or ICE-TCP to the SFU) is the last resort that always works. Because SFUs have public IPs, TURN is needed far less than in P2P.

**Room placement:** pin a meeting to one SFU in the region of the first joiner (or the majority). If participants are spread across continents, **cascade** SFUs: each region's SFU receives local publishers once and relays one copy over the backbone to the other region.`,
      diagram: `  Client A (Mumbai)                       Client B (Frankfurt)
   |  WSS signaling        SRTP/UDP           |
   |-------------+     +--------------+       |
   v             v     v              |       v
 [Meeting / signaling svc] <--> [Redis room state]
   |  assign SFU, issue TURN creds
   v
 [SFU ap-south-1] <=== backbone cascade ===> [SFU eu-central-1]
   ^   ^                                         ^
   |   +-- Client C (UDP blocked) via TURN/TLS:443
   |
 [Recorder bot: subscribes to all tracks -> object store]
 [STUN/TURN fleet (anycast)]   [PSTN gateway: mixes audio for dial-in]`,
      code: [
        {
          language: 'typescript',
          title: 'Join: pick an SFU with headroom and mint ephemeral TURN credentials (TURN REST convention)',
          code: `import { createHmac } from 'node:crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
const TURN_SECRET = process.env.TURN_SECRET!;  // shared with the TURN servers

export async function joinMeeting(meetingId: string, userId: string, region: string) {
  // 1. Sticky: if the meeting already lives on an SFU, everyone joins it.
  let sfu = await redis.get('meeting:' + meetingId + ':sfu');
  if (!sfu) {
    // 2. Least-loaded SFU in the region; score = current egress Mbps.
    const [candidate] = await redis.zrange('sfu:load:' + region, 0, 0);
    if (!candidate) throw new Error('no SFU capacity in ' + region);
    // NX: two first-joiners racing must end up on the same SFU
    await redis.set('meeting:' + meetingId + ':sfu', candidate, 'EX', 86400, 'NX');
    sfu = (await redis.get('meeting:' + meetingId + ':sfu'))!;
  }

  // 3. Ephemeral TURN creds: username = expiry:user, password = HMAC(secret, username)
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const username = expiry + ':' + userId;
  const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64');

  return {
    sfu,
    iceServers: [
      { urls: ['stun:stun.example.com:3478'] },
      { urls: ['turn:turn.example.com:3478?transport=udp',
               'turns:turn.example.com:443?transport=tcp'], username, credential },
    ],
  };
}`,
        },
      ],
      keyPoints: [
        'Signaling over WebSocket; media over SRTP/UDP to the SFU.',
        'ICE: host → STUN reflexive → TURN relay; TURN/TLS 443 for locked-down networks.',
        'Meeting pinned to one SFU; cascade SFUs across regions.',
      ],
      source: 'IETF — ICE (RFC 8445), TURN (RFC 8656), TURN REST API draft',
    },
    {
      heading: 'Video conferencing (3/3): simulcast, bandwidth estimation, big rooms, recording and E2EE',
      body: `**Simulcast vs SVC.** With **simulcast**, each publisher encodes 2–3 independent resolutions (e.g. 720p/360p/180p) and the SFU forwards one layer per subscriber. **SVC** (VP9/AV1) encodes one stream with stacked spatial/temporal layers that the SFU can strip. Either way the SFU adapts per subscriber **without transcoding**.

**Bandwidth estimation.** Each receiver reports packet arrival times (transport-wide congestion control feedback). Google Congestion Control-style estimators turn delay growth and loss into an available-bandwidth estimate. The SFU picks the highest layer that fits, with **hysteresis** (switch up slowly, down fast) to avoid oscillation.

**Switching layers safely.** You can only switch to a new layer at a **keyframe**. The SFU sends a PLI (picture loss indication) to the publisher, waits for the keyframe, then rewrites RTP sequence numbers and timestamps so the subscriber's decoder sees one continuous stream. Rate-limit PLIs: 50 subscribers switching at once must not trigger 50 keyframes, because keyframes are 5–10× the size of a delta frame.

**Loss and jitter.** Audio uses Opus in-band FEC plus a jitter buffer of 20–80 ms. Video uses NACK/RTX retransmission when the RTT is short, and FEC when it is long. Never retransmit audio that is already too late to play.

**Big rooms (50–1,000).** Use **Last-N**: forward video only for the N most recent active speakers (found from the audio-level RTP header extension, so the SFU never decodes). Send everyone else as audio-only or tiny thumbnails on demand. Past ~1,000, convert to a webinar: panelists on the SFU and the audience on an HLS/LL-HLS live stream.

**Recording.** A recorder "bot" joins as a hidden subscriber, stores each track separately (per-participant tracks also feed transcription/AI summaries), and an offline job composites the layout. This is cheaper and more flexible than recording through an MCU.

**E2EE.** Insertable streams + SFrame encrypt frame payloads with keys the server never sees. The SFU still routes because RTP headers stay readable, but anything that needs the media on the server (cloud recording, server-side captions, PSTN mixing) stops working or moves to the client.`,
      code: [
        {
          language: 'typescript',
          title: 'Per-subscriber simulcast layer selection with hysteresis',
          code: `interface Layer { rid: 'q' | 'h' | 'f'; bitrateKbps: number }  // quarter/half/full
interface SubscriberState {
  current: Layer['rid'];
  estimateKbps: number;   // from transport-cc feedback
  upSinceMs?: number;     // when the estimate first allowed a higher layer
}

const ORDER: Layer['rid'][] = ['q', 'h', 'f'];
const rank = (r: Layer['rid']) => ORDER.indexOf(r);
const UP_HOLD_MS = 3000;  // must be stable 3 s before switching UP
const HEADROOM = 0.85;    // leave room for audio + retransmissions

export function chooseLayer(
  layers: Layer[], s: SubscriberState, viewportHeight: number, now: number,
): Layer['rid'] {
  // never send more pixels than the tile can show (thumbnail -> 'q')
  const capRank = viewportHeight <= 180 ? 0 : viewportHeight <= 360 ? 1 : 2;
  const budget = s.estimateKbps * HEADROOM;
  let target: Layer['rid'] = 'q';  // lowest layer is the floor
  for (const l of layers) {
    const r = rank(l.rid);
    if (r <= capRank && l.bitrateKbps <= budget && r > rank(target)) target = l.rid;
  }

  if (rank(target) < rank(s.current)) { s.upSinceMs = undefined; return target; }  // down: now
  if (rank(target) > rank(s.current)) {
    s.upSinceMs ??= now;                                     // up: only after hold
    return now - s.upSinceMs >= UP_HOLD_MS ? target : s.current;
  }
  s.upSinceMs = undefined;
  return s.current;  // caller requests a keyframe (rate-limited PLI) on change
}`,
        },
      ],
      keyPoints: [
        'SFU adapts per subscriber via simulcast/SVC: no transcoding.',
        'Switch layers only on keyframes; rate-limit PLIs.',
        'Last-N video for big rooms; webinar mode beyond ~1,000.',
        'E2EE (SFrame) keeps routing but breaks server-side recording/captions.',
      ],
      source: 'Jitsi — Last N and simulcast; IETF — Transport-wide CC, SFrame (RFC 9605)',
    },
    // ---------------- LLM CHAT / INFERENCE ----------------
    {
      heading: 'ChatGPT-style LLM chat service (1/3): requirements, estimation & why GPUs change everything',
      body: `**Intuition:** in most designs the expensive thing is the database. Here, a single 8-GPU node costs more per hour than a whole fleet of API servers, and every response is a **long-running stream**, not a request. Your job is to keep the GPUs busy while still giving each user their first token fast.

**Functional:** send a prompt and stream the reply token by token; conversations persist and can be resumed with prior context; stop/regenerate; model picker; tiers (free, paid, API keys with quotas). Out of scope unless asked: training, fine-tuning, RAG/tools, multimodal.

**Non-functional (name the LLM-specific metrics):**
- **TTFT** (time to first token): p50 < 0.5–1 s. This is what users perceive as speed.
- **TPOT / inter-token latency:** ~20–50 ms (20–50 tokens/s, faster than reading speed).
- Throughput per GPU (tokens/s) and **cost per million tokens** are first-class requirements.
- Conversations durable; a dropped connection or a deploy must not lose a half-streamed answer.

**Two phases of inference:**

| | Prefill | Decode |
|---|---|---|
| Work | process all prompt tokens in parallel | generate one token per step per sequence |
| Bound by | compute (FLOPs) | **memory bandwidth** (read all weights + KV every step) |
| Drives | TTFT | TPOT, throughput |

Why batching is everything: a 70B fp16 model is ~140 GB of weights. On 8 × H100 (≈ 3.35 TB/s HBM each, 26.8 TB/s total) one decode step takes at least 140 GB ÷ 26.8 TB/s ≈ **5.2 ms**, so a single stream tops out near ~190 tokens/s. Because each step reads the weights once **regardless of batch size**, batching 100+ sequences multiplies throughput almost for free, until KV-cache memory runs out.

**Estimation (own assumptions; Hello Interview's breakdown lands in the same range):**
- Peak 20K prompts/s × 300 output tokens = **6M output tokens/s**.
- Each stream lasts 300 ÷ 50 tok/s = 6 s → Little's law: 20K × 6 = **120K concurrent streams**.
- KV cache for a 70B GQA model: 2 × 80 layers × 8 KV heads × 128 dims × 2 bytes = **320 KiB/token** → 1.25 GiB per 4K-token conversation.
- 8 × 80 GB = 640 GB per node − 140 GB weights − ~60 GB activations/overhead ≈ 440 GB for KV → ~352 concurrent sequences → **~343 nodes (~2,750 GPUs)** at 50 tok/s each.`,
      keyPoints: [
        'TTFT ← prefill (compute); TPOT ← decode (memory bandwidth).',
        'Decode step ≈ weights ÷ HBM bandwidth: batching is nearly free throughput.',
        'KV cache per token = 2 × layers × KV heads × head_dim × bytes; it caps concurrency.',
      ],
      source: 'Hello Interview — ChatGPT breakdown; Kwon et al. — vLLM/PagedAttention (SOSP 2023)',
    },
    {
      heading: 'LLM chat service (2/3): API, conversation storage and the serving architecture',
      body: `**API:**
- \`POST /v1/conversations/{id}/messages\` body \`{ clientMessageId, content, model, maxTokens }\` → response is an **SSE stream** (\`Content-Type: text/event-stream\`): \`event: delta\` chunks with ids, then \`event: done\` with usage. Use \`fetch\` + a stream reader on the client, because EventSource only does GET.
- \`GET /v1/messages/{id}/stream\` with \`Last-Event-ID\` → resume an in-flight or finished answer after a reload.
- \`POST /v1/messages/{id}/cancel\` → stop button, which frees the GPU slot.
- \`GET /v1/conversations?cursor=\` and \`GET /v1/conversations/{id}/messages?before=\` for history.

**Data model:**
- \`conversations\`: partition key \`user_id\`, clustering \`updated_at DESC\` → list sidebar (Cassandra/DynamoDB; ~billions of rows).
- \`messages\`: partition \`conversation_id\`, clustering \`seq\`; columns \`role, content, model, status (streaming|complete|stopped|failed), prompt_tokens, output_tokens, parent_id\` (parent enables regenerate/branching).
- \`usage_ledger\`: append-only token counts per user/key per request → billing and quota reconciliation (Kafka → warehouse).
- In-flight output: a **per-message Redis Stream** (TTL ~1 h). This is the buffer that SSE readers tail, so generation does not depend on the client's TCP connection.

**Context building:** the model is stateless. Every turn re-sends system prompt + history + new message, trimmed to the context window. Trim in **stable chunks** (summarise the oldest block once) rather than sliding one turn at a time: a sliding window changes the prompt prefix on every turn and destroys prefix-cache hits.`,
      diagram: `Client --POST + SSE--> [Edge / API gateway: auth, req/s limit, TLS]
                             |
                       [Chat service] -----> [Conversation store]
                        |  |   |               (Cassandra/Dynamo)
     token reserve/refund  |   +--> [Moderation: input sync, output async]
      [Redis token buckets]|
                           v
            [Inference router / scheduler]
     tier queues (paid > free), prefix-hash affinity, admission control
              |                 |                  |
     [Pool: large model] [Pool: small model] [Prefill pool]*
      vLLM/TensorRT-LLM replicas, 8 GPUs each, continuous batching,
      paged KV cache, prefix cache          (*optional disaggregation)
              |
       gRPC token stream
              v
 [Stream writer] -> Redis Stream msg:{id} -> SSE readers (resume by id)
              \\-> persist final message + usage_ledger (Kafka)`,
      code: [
        {
          language: 'typescript',
          title: 'Context builder: fit history into the window without destroying the prefix cache',
          code: `interface Turn { role: 'system' | 'user' | 'assistant'; content: string; tokens: number }

const CHUNK = 20;  // summarise/drop history in blocks of 20 turns, not one by one

export function buildContext(o: {
  system: Turn;
  history: Turn[];          // oldest -> newest, excluding the new user message
  summaries: Turn[];        // summaries[k] covers turns [k*CHUNK, (k+1)*CHUNK)
  user: Turn;
  contextWindow: number;
  maxOutput: number;
}): Turn[] {
  const fixed = o.system.tokens + o.user.tokens + o.maxOutput;
  if (fixed > o.contextWindow) throw new Error('prompt_too_long');  // 400 to client

  // Drop whole chunks from the front until the rest fits. The prefix
  // [system, summaries..., remaining turns] stays byte-identical across turns
  // until the NEXT chunk boundary, so the inference replica's prefix cache hits.
  for (let dropped = 0; dropped * CHUNK <= o.history.length; dropped++) {
    const kept = o.history.slice(dropped * CHUNK);
    const sums = o.summaries.slice(0, dropped);
    const used = fixed
      + sums.reduce((n, t) => n + t.tokens, 0)
      + kept.reduce((n, t) => n + t.tokens, 0);
    if (used <= o.contextWindow) return [o.system, ...sums, ...kept, o.user];
  }
  // even the summaries do not fit: keep the newest summaries only
  return [o.system, ...o.summaries.slice(-2), o.user];
}`,
        },
      ],
      keyPoints: [
        'POST returns SSE; a separate resume endpoint reads the per-message buffer by event id.',
        'Messages partitioned by conversation, clustered by seq; usage in an append-only ledger.',
        'Trim history in stable chunks to keep prefix-cache hits.',
      ],
      source: 'Hello Interview — ChatGPT breakdown (2025); OpenAI-style streaming API conventions',
    },
    {
      heading: 'LLM chat service (3/3): continuous batching, KV memory, routing, token rate limits and overload',
      body: `**Continuous (iteration-level) batching.** With static batching, a batch of 32 waits for its *longest* generation, and new requests queue behind it. Orca-style schedulers make the scheduling decision **every decode step**: finished sequences leave, and waiting ones join after their prefill. This alone gives several times higher throughput and much lower queueing.

**PagedAttention.** Pre-allocating KV for \`max_tokens\` per request wasted 60–80% of KV memory in older servers (the vLLM paper's measurement). vLLM stores KV in fixed-size **blocks** (e.g. 16 tokens) via a page table, with under 4% waste, and shares blocks between sequences with a common prefix. More free KV means bigger batches and more tokens/s.

**Prefill vs decode interference.** A 30K-token prefill landing in a decode batch stalls every streaming user. Fixes: **chunked prefill** (split long prompts into slices interleaved with decode steps), or **disaggregated prefill/decode pools** that transfer the KV cache after prefill (DistServe/Splitwise-style). Further levers: speculative decoding (a small draft model proposes tokens that the big model verifies in one pass), fp8 weights and KV (halves memory), and tensor parallelism inside a node.

**Routing.** Route by \`hash(conversation prefix)\` to the replica that probably holds the prefix in cache (consistent hashing with bounded load). Fall back to least-loaded when the hot replica's queue is deep. Signals for the router: queue depth, free KV blocks and running batch size, **not** CPU or request count.

**Rate limiting in tokens.** Requests per minute is meaningless when one request may cost 50 or 50,000 tokens. Use token buckets per user/key/org. At admission, **reserve** \`prompt_tokens + max_tokens\`; when the stream ends, **refund** the unused part. Charging only after completion lets 50 parallel requests through before any of them is counted.

**Overload and tiers.** Use separate queues per tier with weighted fair scheduling. Under pressure: shorten free-tier \`max_tokens\`, route free users to a smaller model, then return 429/503 with \`Retry-After\` to free users before paid ones feel anything. The stop button and client cancellation must reach the engine so it frees KV blocks immediately.`,
      code: [
        {
          language: 'lua',
          title: 'Token bucket in LLM tokens: atomic reserve (refund uses a negative cost)',
          code: `-- KEYS[1] = bucket key, e.g. tb:org:42:gpt-large
-- ARGV: capacity, refill_per_sec, now_ms, cost (negative cost = refund)
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now  = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
tokens = math.min(cap, tokens + math.max(0, now - ts) / 1000 * rate)  -- refill

if cost > 0 and cost > tokens then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
  -- tell the client when enough tokens will exist
  return {0, math.ceil((cost - tokens) / rate * 1000)}
end

tokens = math.min(cap, tokens - cost)    -- reserve, or refund capped at capacity
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) + 60000)
return {1, 0}`,
        },
        {
          language: 'typescript',
          title: 'Reserve before generation, refund what was not used',
          code: `const reserve = promptTokens + req.maxTokens;
const [ok, retryAfterMs] = (await redis.tokenBucket(
  key, CAPACITY, REFILL_PER_SEC, Date.now(), reserve)) as [number, number];
if (!ok) throw new TooManyRequests({ retryAfterMs });

let produced = 0;
try {
  for await (const delta of engine.generate(prompt, { maxTokens: req.maxTokens, signal })) {
    produced += delta.tokens;
    await stream.append(delta);
  }
} finally {
  const unused = reserve - (promptTokens + produced);
  if (unused > 0) await redis.tokenBucket(key, CAPACITY, REFILL_PER_SEC, Date.now(), -unused);
  await ledger.record({ key, promptTokens, outputTokens: produced });  // billing truth
}`,
        },
      ],
      keyPoints: [
        'Continuous batching: schedule per decode step, not per batch.',
        'PagedAttention: KV in blocks → <4% waste, prefix sharing.',
        'Chunked prefill or disaggregation stops long prompts from stalling streams.',
        'Reserve prompt + max_tokens, refund the rest; route on KV/queue signals.',
      ],
      source: 'Yu et al. — Orca (OSDI 2022); Kwon et al. — vLLM (SOSP 2023); Zhong et al. — DistServe (OSDI 2024)',
    },
    // ---------------- GOOGLE DOCS ----------------
    {
      heading: 'Google Docs collaborative editing (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** several people write on the same whiteboard at once, and everyone's copy must end up **identical** and **look like what each person meant**, even though their edits cross in flight. Every keystroke is applied locally right away (optimistic), and the system's job is to reconcile concurrent edits so every replica converges.

**Functional:** create/open a doc; concurrent rich-text editing; live cursors and selections of others (presence); comments anchored to text; version history and restore; offline edits that sync later; sharing with roles (owner/editor/commenter/viewer). Google documents a limit of about 100 people working in one file at the same time; past that, only the owner and editors can keep editing, so very large audiences need a separate read path.

**Non-functional:** local echo in 0 ms; remote edits visible in < 100–300 ms; **convergence** (all replicas end identical) and **intention preservation**; no acknowledged edit is ever lost; documents up to a few MB; history kept indefinitely (compacted).

**Estimation (assumptions):** 1M users actively typing at peak; clients batch keystrokes every ~200 ms → ≤ 5 op messages/s each → **5M op msgs/s**. At ~50K msgs/s per collaboration server → **~100 servers** for the write path (fan-out to 2–3 co-editors on average is cheap). Op log at ~100 B/op: 5M × 100 B = **500 MB/s at peak**; with an average of ~30% of peak over the day ≈ **13 TB/day**, which is why the log must be compacted into snapshots.

**API:**
- \`GET /v1/docs/{id}\` → \`{ snapshot, rev }\`; \`GET /v1/docs/{id}/revisions?from=&to=\`; \`POST /v1/docs/{id}/restore\`.
- \`WSS /v1/docs/{id}/session\` → the real-time protocol below.

**Data model:**
- \`documents(doc_id, owner_id, title, latest_snapshot_rev, created_at)\`
- \`doc_ops(doc_id, rev, author_id, client_id, client_seq, ops_json, ts)\` with **PRIMARY KEY (doc_id, rev)** → append-only and fenced (see 3/3)
- \`snapshots(doc_id, rev, object_key)\` every ~500 ops or 10 min; \`acl(doc_id, principal, role)\`; \`comments(doc_id, comment_id, anchor, thread_json)\`.`,
      code: [
        {
          language: 'typescript',
          title: 'Wire protocol for a document session (one outstanding op per client)',
          code: `// Ops are positional on plain text for clarity; rich text adds attributes.
export type Op =
  | { type: 'ins'; pos: number; ch: string }
  | { type: 'del'; pos: number };

// client -> server
export type ClientMsg =
  | { t: 'op'; clientId: string; clientSeq: number; baseRev: number; op: Op }
  | { t: 'presence'; cursor: number; selectionEnd?: number }  // ephemeral
  | { t: 'resync'; fromRev: number };                         // after reconnect

// server -> client
export type ServerMsg =
  | { t: 'ack'; clientSeq: number; rev: number }              // your op became rev
  | { t: 'op'; rev: number; clientId: string; op: Op }        // someone else's op
  | { t: 'presence'; userId: string; cursor: number; color: string }
  | { t: 'snapshot'; rev: number; text: string };             // too far behind

// Client rule (Jupiter / Google Wave style): at most ONE op in flight.
// While waiting for 'ack', local edits are composed into a buffer; incoming
// remote ops are transformed against both the in-flight op and the buffer.`,
        },
      ],
      keyPoints: [
        'Goal: convergence + intention preservation with optimistic local apply.',
        'Op log keyed (doc_id, rev); periodic snapshots bound load time and storage.',
        'One in-flight op per client keeps the transform bookkeeping simple.',
      ],
      source: 'Google Wave Operational Transformation whitepaper; Hello Interview — Google Docs breakdown',
    },
    {
      heading: 'Google Docs (2/3): OT vs CRDT — the transform function and when to choose which',
      body: `**The core problem:** the doc is "abc". A inserts X at 1 while B deletes index 2 ('c'), both based on rev 5. If the server applies A's op and then B's op unchanged, B's delete hits 'b' in "aXbc" and gives "aXc", which is wrong. **Operational Transformation (OT)** rewrites B's op against A's: the delete shifts to index 3, and everyone converges on "aXb".

**OT with a central server (Google Docs, Wave's Jupiter model):** the server is the single sequencer per doc. A client op that arrives with \`baseRev = r\` is transformed against every op the server committed after \`r\`, then assigned the next rev. Because the server imposes a total order, you only need the transform property TP1, not the much harder TP2 that peer-to-peer OT requires. **Ties** (two inserts at the same position) must be broken deterministically, e.g. by client id, and both sides must use the same rule.

**CRDTs (Yjs, Automerge, Fugue):** every character gets a unique, immutable id (site id + counter) and inserts reference their neighbour's id, not an index. Concurrent ops commute by construction, so replicas merge in any order. No server ordering is needed, which suits offline-first apps and P2P.

| | OT (central server) | CRDT |
|---|---|---|
| Ordering authority | server per doc | none needed |
| Offline / P2P | awkward (long transform chains) | natural |
| Metadata | tiny (positions) | ids per character + tombstones; needs GC |
| Complexity | transform functions per op pair | data structure; interleaving anomalies in some algorithms |
| Used by | Google Docs, Wave lineage | Yjs/Automerge-based editors, local-first apps (Figma uses a CRDT-inspired but server-authoritative scheme) |

**Say in interviews:** "I'll use server-sequenced OT because we already need a server for permissions, persistence and fan-out. If offline-first or P2P is a hard requirement, I'd switch to a CRDT like Yjs and still keep a server as the durable relay."`,
      code: [
        {
          language: 'typescript',
          title: 'OT transform for single-character insert/delete (TP1, deterministic tie-break)',
          code: `import type { Op } from './protocol';

// Return a' = a rewritten to apply AFTER b, where a and b were concurrent
// (same base). aWinsTie decides order for inserts at the same position and
// MUST be computed identically everywhere (e.g. compare client ids).
export function transform(a: Op, b: Op, aWinsTie: boolean): Op | null {
  if (a.type === 'ins' && b.type === 'ins') {
    if (b.pos < a.pos || (b.pos === a.pos && !aWinsTie)) return { ...a, pos: a.pos + 1 };
    return a;
  }
  if (a.type === 'ins' && b.type === 'del') {
    return b.pos < a.pos ? { ...a, pos: a.pos - 1 } : a;
  }
  if (a.type === 'del' && b.type === 'ins') {
    return b.pos <= a.pos ? { ...a, pos: a.pos + 1 } : a;
  }
  // both deletes
  if (b.pos < a.pos) return { ...a, pos: a.pos - 1 };
  if (b.pos === a.pos) return null;  // same char already deleted: a becomes a no-op
  return a;
}

export function apply(text: string, op: Op | null): string {
  if (!op) return text;
  return op.type === 'ins'
    ? text.slice(0, op.pos) + op.ch + text.slice(op.pos)
    : text.slice(0, op.pos) + text.slice(op.pos + 1);
}

// "abc": A = ins(1,'X'), B = del(2). Server applies A, then transform(B, A):
// del(2) -> del(3) -> "aXbc" becomes "aXb" on every replica.`,
        },
      ],
      keyPoints: [
        'Central sequencer OT needs only TP1; P2P OT needs TP2 (hard).',
        'Ties at the same position need a deterministic, shared tie-break.',
        'CRDT: id-based positions, commutative merges, metadata/tombstone cost.',
      ],
      source: 'Ellis & Gibbs (1989); Nichols et al. — Jupiter (1995); Shapiro et al. — CRDTs (2011)',
    },
    {
      heading: 'Google Docs (3/3): architecture — per-doc ownership, presence, snapshots and failover',
      body: `**One owner per document.** Every op for a doc must go through one sequencer, so route all sessions for \`doc_id\` to the same collaboration server: consistent hashing on doc id at the WebSocket gateway, plus an **ownership lease** in a coordination store. Load is skewed (most docs have 1 editor, a few have 100), so the hash ring uses bounded loads and hot docs can be moved.

**Write path:** receive op → dedupe by \`(clientId, clientSeq)\` → transform against ops since \`baseRev\` → **append \`(doc_id, rev)\` to the op log** → ack the author → broadcast to other sessions. Ack only **after** the durable append. The primary key on \`(doc_id, rev)\` is the **fencing** mechanism: if a paused ex-owner wakes up and tries to write rev 9001, its insert fails because the new owner already wrote it, and the old owner drops the doc.

**Presence and cursors** are ephemeral: sent over the same socket but **never persisted**, throttled to ~10 updates/s per user, last-value-wins, and expired after a heartbeat timeout. Cursor positions must also be transformed against incoming ops (or anchored to CRDT ids), or they drift.

**Load and recovery:** open doc = latest snapshot + ops after it. A background compactor writes a snapshot every ~500 ops. Version history shows snapshots plus grouped ops ("edits by Asha, 10:02–10:15"), not every keystroke. A client that reconnects after N revisions sends \`resync\`: replay ops if N is small, or send a fresh snapshot if N is large and rebase local pending ops.

**Viral docs:** a 2,000-viewer all-hands doc keeps editors on the owner, while viewers subscribe to a read-only fan-out tier that relays committed ops. The sequencer is never in the viewers' path.`,
      diagram: `Clients (editors)        Clients (viewers)
     | WSS                       | WSS
     v                           v
 [Gateway: route by hash(doc_id)] --> [Read fan-out tier]
     |                                    ^ committed ops
     v                                    |
 [Collab server = owner of doc 42] -------+
   | 1 dedupe (clientId, clientSeq)
   | 2 transform vs ops since baseRev
   | 3 INSERT doc_ops(doc_id, rev) --> [Op log: Spanner/Postgres/Bigtable]
   | 4 ack author, broadcast others        |
   |                                       v
 [Lease store: owner + epoch]     [Compactor -> snapshots in object store]
 [Presence: in-memory only, throttled, expires on heartbeat loss]`,
      code: [
        {
          language: 'sql',
          title: 'The op log primary key is the fence: two owners can never both commit rev N',
          code: `CREATE TABLE doc_ops (
  doc_id     uuid        NOT NULL,
  rev        bigint      NOT NULL,
  author_id  uuid        NOT NULL,
  client_id  text        NOT NULL,
  client_seq bigint      NOT NULL,
  ops        jsonb       NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, rev),
  UNIQUE (doc_id, client_id, client_seq)   -- retries cannot create a second rev
);

-- Owner commits the next revision. A stale owner (lost lease, GC pause)
-- computes the same rev and gets 0 rows: it must drop ownership and resync.
INSERT INTO doc_ops (doc_id, rev, author_id, client_id, client_seq, ops)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING
RETURNING rev;

-- Open document: newest snapshot, then the tail of the log
SELECT rev, ops FROM doc_ops
WHERE doc_id = $1 AND rev > $2   -- $2 = snapshot rev
ORDER BY rev;`,
        },
      ],
      keyPoints: [
        'Sticky routing by doc id + lease; the (doc_id, rev) PK fences stale owners.',
        'Ack only after the durable append; dedupe retries by (clientId, clientSeq).',
        'Presence is ephemeral and throttled; snapshots bound load time.',
        'Viewers read from a fan-out tier, never from the sequencer.',
      ],
      source: 'Google Wave OT whitepaper; Martin Kleppmann — Designing Data-Intensive Applications, Ch 5 & 9 (fencing)',
    },
    {
      heading: 'Bottlenecks, trade-offs & wrap-up across the four real-time designs',
      body: `All four designs are **stateful real-time systems**. The winning move each time is deciding **where the state lives and who owns ordering**, and then protecting the most expensive resource.

| | Live streaming | Video conferencing | LLM chat | Collaborative docs |
|---|---|---|---|---|
| Expensive resource | CDN egress | SFU egress + TURN relay | GPU HBM (KV cache) | sequencer per doc |
| Unit of fan-out | segment → millions | track → room members | token → 1 user | op → co-editors |
| Ordering owner | packager (segment seq) | publisher (RTP seq) | engine (token index) | collab server (rev) |
| Latency budget | 2–30 s by choice | ~150 ms one-way | TTFT < 1 s, 20–50 ms/token | < 300 ms remote echo |
| Degrade first | bitrate cap, panic mode | video layers, Last-N | smaller model, max_tokens, free tier | viewers read-only, presence rate |
| Stateful failure | origin/packager failover | SFU loss → ICE restart | stream resume from buffer | lease + fenced op log |

**Recurring patterns to name out loud:**
- **Aggregate before you fan out** (reaction counts, Last-N video, op batching every 200 ms).
- **Separate the durable path from the ephemeral path** (op log vs presence; persisted message vs in-flight token buffer; segments vs playlist).
- **Scale on the leading signal:** concurrency for streams, KV blocks/queue depth for GPUs, egress for SFUs. CPU is the wrong signal in all four.
- **Decouple producers from fragile client connections:** a reload, a network change or a deploy must resume (Last-Event-ID, ICE restart, resync from rev), not restart work.

**Common senior-level follow-ups:** cost per viewer-hour or per million tokens, multi-region (cascade SFUs; pin a doc's owner near its editors; GPU capacity follows the sun), abuse (comment spam, prompt injection, meeting bombing), and observability per stream/meeting/doc rather than per host.`,
      keyPoints: [
        'Decide state location + ordering owner first; then protect the expensive resource.',
        'Aggregate before fan-out; keep ephemeral data off the durable path.',
        'Scale on leading signals; make every client reconnect a resume.',
      ],
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `**Intuition:** all four designs are real-time, so the level gap shows in *who protects the expensive resource*. That resource is CDN egress, SFU bandwidth, GPU memory or the per-document sequencer. Mid (≈80% breadth / 20% depth, interviewer steers) gets the pipeline right. Senior (≈60/40) skims the HLD, deep-dives the bottleneck unprompted and names trade-offs. Staff (≈40/60) drives, and adds cost, failure drills and rollout without being asked.

**Live streaming (IPL scale)**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | watch live, ABR, chat out of scope | 60M concurrent, latency target (2–5 s vs 10 s), the toss spike | latency tier as a cost decision; rights, ads, multi-CDN |
| High-level design | ingest → transcode → CDN | dual ingest, aligned-GOP ladder, short-TTL playlists, shield tier | multi-CDN steering, request collapsing, panic mode |
| Deep dives expected | segments + CDN caching | LL-HLS parts, origin protection | pre-warm ladder, spike game-days |
| Trade-offs & failure handling | none | latency vs rebuffering | seamless encoder failover; CDN outage steering |
| Ops/cost/evolution | none | egress estimate (~59 Tbps) | CDN commit contracts, cost per viewer-hour |

*Down-levelled by:* origin serving misses directly; one latency target for every product surface; no egress number.

**Video conferencing**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | N-party call, mute, screen share | ~150 ms one-way budget, max room size, recording | E2EE policy vs recording/captions, residency |
| High-level design | mesh or a media server | WS signaling + SFU + ICE/STUN/TURN | cascaded SFUs across regions, meeting placement |
| Deep dives expected | why not mesh | simulcast/SVC layer choice, bandwidth estimation | big rooms (last-N, webinar mode), SFrame E2EE |
| Trade-offs & failure handling | none | mesh vs SFU vs MCU | SFU crash → ICE restart onto a new SFU |
| Ops/cost/evolution | none | ~6 Gbps per SFU sizing | TURN relay egress cost; regional capacity |

*Down-levelled by:* transcoding everything in an MCU by default; ignoring NAT and TURN.

**LLM chat service**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | send message, streamed reply, history | TTFT and TPOT targets, context length, token-based limits | cost per 1M tokens, tiered SLAs, model rollout |
| High-level design | API → model server | SSE + resume, conversation store, router to GPU pools | prefix-cache-aware routing, admission control, multi-model fleet |
| Deep dives expected | streaming | continuous batching, KV-cache memory | PagedAttention, chunked prefill / disaggregation, overload |
| Trade-offs & failure handling | none | batch size: throughput vs latency | GPU node loss mid-stream; shedding free tier first |
| Ops/cost/evolution | none | GPU count estimate | canary of model versions, usage ledger, utilisation targets |

*Down-levelled by:* treating a GPU like a stateless web server; rate limiting by request count.

**Google Docs**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | concurrent edits, cursors | local-echo latency, editors per doc, offline | history, retention, permissions, comments |
| High-level design | save whole doc | ops over WS to a per-doc owner, op log + snapshots | sharded ownership with leases + fencing, viewer fan-out |
| Deep dives expected | conflict detection | OT transform with a central sequencer | OT vs CRDT choice argued from requirements |
| Trade-offs & failure handling | last write wins | ack only after durable append | owner failover without losing acked ops |
| Ops/cost/evolution | none | snapshot cadence | hot docs (10K viewers), op-log storage cost, migration |

*Down-levelled by:* locking paragraphs; CRDT chosen "because it is modern" with no offline need.`,
      keyPoints: [
        'The level gap is who protects the expensive resource: egress, SFU bandwidth, GPU memory, the sequencer.',
        'Senior names the bottleneck mechanism; staff prices it and plans its failure.',
        'Each design has a classic down-level trap: origin misses, MCU by default, request-count limits, LWW.',
      ],
      source: 'Hello Interview — problem breakdowns, "What is expected at each level"',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Intuition:** each rung removes a specific failure the previous rung has under load. Say the failure out loud before you climb.

**Live streaming — surviving the toss (30M players request the next segment at once)**
- **Bad:** CDN misses go straight to origin. Every new segment and playlist triggers a miss storm and origin collapses within seconds.
- **Good:** add a shield tier, so misses are per-PoP, not per-viewer. Origin still sees bursts on every playlist refresh, and cold PoPs spike.
- **Great:** request collapsing at the shield (one origin fetch per object), so origin load stays flat at tens of req/s regardless of audience. Pre-warm CDN capacity on a concurrency ladder, jitter player reloads, and keep a panic mode that sheds reactions and comments before video.

**Live streaming — latency**
- **Bad:** 6 s segments with a 3-segment buffer means 20–30 s behind TV.
- **Good:** 2 s segments give ~6–10 s, at 3× the request rate.
- **Great:** LL-HLS partial segments with blocking playlist reload give 2–5 s on the same CDN. WebRTC goes only to interactive tiers, because it costs far more per viewer.

**Video conferencing — a 10-person call on mixed networks**
- **Bad:** in a mesh, each client uploads N−1 streams (9 × 1.5 Mbps), so it collapses at 4–5 people. An MCU fixes the uplink but burns a transcode per room.
- **Good:** an SFU forwards one stream per publisher. One weak subscriber then forces a choice between degrading everyone and stalling that subscriber.
- **Great:** simulcast (3 layers) or SVC. The SFU picks a layer per subscriber from transport-cc estimates, switches only on keyframes and rate-limits PLIs. No transcoding, constant uplink, and per-viewer quality.

**Video conferencing — connectivity**
- **Bad:** assume direct UDP. **Good:** STUN for reflexive candidates. **Great:** TURN fallback, including TURN over TLS on 443 for corporate networks. Budget that ~10–15% of sessions relay, and that relay egress is real cost.

**LLM chat — GPU throughput**
- **Bad:** one request per GPU, or static batches that wait for the longest generation. Utilisation sits at 10–30% and TTFT queues grow.
- **Good:** dynamic batching over a short window. That is better, but finished sequences still hold their slot.
- **Great:** iteration-level (continuous) batching plus paged KV cache (<4% waste, prefix sharing). Chunked prefill stops a 100K-token prompt from stalling everyone's TPOT, and admission is decided by free KV blocks, not request count.

**LLM chat — overload and fairness**
- **Bad:** requests-per-minute limits, under which a 100K-token prompt costs the same as "hi". **Good:** token buckets on prompt tokens. **Great:** reserve prompt + max_tokens at admission and refund the unused part. Queue with deadlines, route on queue depth and KV pressure, and shed the free tier first.

**Google Docs — two users type at the same position**
- **Bad:** paragraph locks (latency, abandoned locks) or last-write-wins on the document (lost edits).
- **Good:** OT with a central per-doc sequencer. Clients transform their pending op against incoming ops, with one in-flight op per client.
- **Great:** add a deterministic tie-break (site id), dedupe by (clientId, clientSeq), ack only after the durable append, and pick a CRDT only if offline or peer-to-peer editing is a requirement. The cost of a CRDT is metadata and tombstones.

**Google Docs — the owner crashes**
- **Bad:** state lives in memory, so acked ops are lost. **Good:** append to the op log before acking, and the new owner rebuilds from snapshot + log. **Great:** lease-based ownership fenced by the (doc_id, rev) primary key, so a zombie owner's writes fail. Clients resend unacked ops, and dedupe makes the retries harmless.`,
      keyPoints: [
        'Origin protection = shield + request collapsing + pre-warm; latency = LL-HLS parts.',
        'Simulcast lets an SFU adapt per subscriber with no transcoding.',
        'Continuous batching + paged KV; token reservations, not request counts.',
        'OT with a sequencer, durable-before-ack, fencing on (doc_id, rev).',
      ],
      source: 'Hello Interview — problem breakdowns (Bad / Good / Great deep dives)',
    },
  ],
  codeChallenges: [
    {
      id: 'design-modern-cc-1',
      title: 'Harden a naive "chat with the model" endpoint',
      context:
        'A startup shipped its ChatGPT-style assistant on NestJS. At launch: users stare at a spinner for 20 s, the GPU bill is 2× forecast, some users get two answers for one question on flaky mobile networks, and a handful of power users run 40 parallel requests that starve everyone else.',
      task: 'Rewrite the handler so the answer streams, retries are safe, cost and fairness are enforced in tokens, abandoned generations stop consuming GPU, and the conversation is never left half-saved. Keep it one handler plus the helpers it calls.',
      starter: {
        language: 'typescript',
        code: `@Post('conversations/:id/messages')
async send(
  @Param('id') convId: string,
  @Body() body: { content: string; maxTokens?: number },
  @Req() req: AuthedRequest,
  @Res() res: Response,
) {
  const history = await this.messages.findAll(convId);   // entire conversation
  const prompt = [SYSTEM_PROMPT, ...history, { role: 'user', content: body.content }];

  // waits for the WHOLE completion before sending a single byte
  const completion = await this.engine.complete(prompt, {
    maxTokens: body.maxTokens ?? 8192,
  });

  await this.messages.insert(convId, { role: 'user', content: body.content });
  await this.messages.insert(convId, { role: 'assistant', content: completion.text });

  // quota counted only after the fact, in requests
  await this.usage.incrementRequests(req.user.id);
  if ((await this.usage.requestsToday(req.user.id)) > 500) {
    throw new HttpException('quota exceeded', 429);
  }
  res.json({ text: completion.text });
}`,
      },
      hints: [
        'Which of these problems are about time-to-first-token, and which are about what happens when the HTTP request is retried or abandoned?',
        'A quota checked after spending cannot stop a burst. What would you have to know before calling the engine to make the decision up front?',
        'Think about what must be durable before the first token is generated, and what must happen in every exit path (success, error, client gone).',
      ],
      solution: {
        language: 'typescript',
        code: `import { once } from 'node:events';

@Post('conversations/:id/messages')
async send(@Param('id') convId: string, @Body() body: SendDto,
           @Req() req: AuthedRequest, @Res() res: Response) {
  // 1. Idempotent user turn: a retried POST resumes, it never regenerates
  const { userMsg, assistant, created } = await this.messages.startTurnOnce(
    convId, body.clientMessageId, body.content);          // UNIQUE(conv, clientMessageId)
  if (!created) return res.redirect(303, '/v1/messages/' + assistant.id + '/stream');

  // 2. Bounded, prefix-stable context instead of the whole history
  const ctx = await this.context.build(convId, userMsg, this.model.window);
  const maxTokens = Math.min(body.maxTokens ?? 1024, this.tiers.maxOutput(req.user));

  // 3. Reserve prompt + max output tokens BEFORE spending GPU (throws 429 + Retry-After)
  const reserved = ctx.promptTokens + maxTokens;
  await this.limiter.reserve(req.user.orgId, reserved);

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                       'X-Accel-Buffering': 'no' });              // disable proxy buffering
  const abort = new AbortController();
  req.on('close', () => abort.abort());                         // client gone -> stop GPU work
  const ping = setInterval(() => res.write(': ping\\n\\n'), 15000);  // keep idle proxies open

  let text = '', produced = 0, status: 'complete' | 'stopped' | 'failed' = 'complete';
  try {
    for await (const d of this.engine.stream(ctx.messages, { maxTokens, signal: abort.signal })) {
      text += d.text; produced += d.tokens;
      const ok = res.write('id: ' + produced + '\\nevent: delta\\ndata: ' +
                           JSON.stringify({ t: d.text }) + '\\n\\n');
      // backpressure: never buffer an unbounded answer for a slow reader
      if (!ok) await Promise.race([once(res, 'drain'), once(abort.signal, 'abort')]);
    }
    res.write('event: done\\ndata: ' + JSON.stringify({ outputTokens: produced }) + '\\n\\n');
  } catch (err) {
    status = abort.signal.aborted ? 'stopped' : 'failed';
    if (!abort.signal.aborted) res.write('event: error\\ndata: {"code":"generation_failed"}\\n\\n');
  } finally {
    clearInterval(ping);
    // 4. Every exit path: persist what we have, refund unused tokens, bill actual usage
    await this.messages.finish(assistant.id, { content: text, status, outputTokens: produced });
    await this.limiter.refund(req.user.orgId, reserved - ctx.promptTokens - produced);
    await this.ledger.record(req.user.orgId, ctx.promptTokens, produced);
    res.end();
  }
}`,
      },
      explanation: `**Fixes, in order of user impact:**
- **Streaming over SSE** turns a 20 s wait into a sub-second TTFT. \`X-Accel-Buffering: no\` and heartbeats stop Nginx and idle-timeout proxies from buffering or killing the stream.
- **Idempotency:** the user turn is created once per \`clientMessageId\` (unique constraint). A mobile retry is redirected to the resume endpoint instead of paying for a second generation and showing two answers.
- **Bounded context:** sending the entire history makes every turn more expensive than the last and eventually overflows the window. The context builder trims in prefix-stable chunks.
- **Token-based admission:** reserve \`prompt + max_tokens\` before calling the engine, and cap \`max_tokens\` per tier (8192 by default was the cost bug). Parallel bursts now fail fast with 429 instead of being counted after the GPU work is done. Unused tokens are refunded and actual usage goes to the ledger.
- **Cancellation:** \`req.on('close')\` aborts the engine call, so the scheduler frees the KV blocks of abandoned answers.
- **Backpressure:** honouring \`write()\` returning false prevents one slow client from holding a large buffer.
- **Durability:** the user message exists before generation, and \`finally\` always records the assistant message with a status (complete/stopped/failed), so history is never half-written.`,
      followUps: [
        {
          q: 'Product now wants a reload or a network switch to continue the same answer, but your handler aborts generation on `close`. How do you change the design?',
          a: 'Decouple generation from the request. A worker runs the generation and appends deltas to a per-message buffer (Redis Stream keyed by message id, TTL ~1 h) and persists the final message. The POST handler and `GET /messages/{id}/stream` are both just readers that tail the buffer from `Last-Event-ID`. A disconnect then cancels nothing. Only an explicit `POST /cancel`, or no reader for ~60 s, sends a cancel to the engine. You pay a little Redis traffic per token in exchange for resumability across reloads and deploys.',
        },
        {
          q: 'How would you test the refund and cancellation paths without a GPU?',
          a: 'Inject a fake engine that yields deltas on a timer and honours the AbortSignal. Integration tests: (1) abort after 3 deltas and assert status `stopped`, refund = reserved − prompt − 3 tokens, and the engine saw the abort; (2) the engine throws mid-stream and you assert status `failed` with the partial text saved; (3) a slow reader, simulated with a writable whose `write()` returns false, and you assert memory stays bounded; (4) two POSTs with the same `clientMessageId` and you assert one engine call. Run the bucket Lua against a real Redis in testcontainers.',
        },
      ],
    },
    {
      id: 'design-modern-cc-2',
      title: 'Fix a collaborative-editing server that makes documents diverge',
      context:
        'An internal "Docs-lite" collaboration server keeps one DocSession per open document in memory. Users report that when two people type in the same paragraph, their screens show different text after a few seconds, edits occasionally vanish after a reconnect, and the Postgres primary is writing 40K rows/s for only 300 active docs.',
      task: 'Make the session converge under concurrent edits, survive client retries and reconnects, and stop the write amplification. You may use the `transform`/`apply` helpers from the OT module.',
      starter: {
        language: 'typescript',
        code: `import { apply, type Op } from './ot';

export class DocSession {
  text = '';
  rev = 0;
  sockets = new Set<WebSocket>();

  constructor(private docId: string, private db: Pool) {}

  async onOp(ws: WebSocket, m: { clientId: string; clientSeq: number; baseRev: number; op: Op }) {
    // apply at the position the client saw, ignoring what happened since baseRev
    this.text = apply(this.text, m.op);
    this.rev++;

    // persist the whole document on every keystroke
    await this.db.query('UPDATE docs SET body = $1, rev = $2 WHERE id = $3',
      [this.text, this.rev, this.docId]);

    // echo to everyone, including the author
    for (const s of this.sockets) {
      s.send(JSON.stringify({ t: 'op', rev: this.rev, op: m.op }));
    }
  }
}`,
      },
      hints: [
        'The op was computed against the document at baseRev. What does the server know that the client did not, and what must happen to the op because of it?',
        'onOp is async. What can another onOp call for the same document do while this one is awaiting the database?',
        'A client resends an op after a timeout. How does the server recognise it, and what should the client receive?',
      ],
      solution: {
        language: 'typescript',
        code: `import { apply, transform, type Op } from './ot';

type Committed = { rev: number; clientId: string; op: Op | null };

export class DocSession {
  private history: Committed[] = [];            // ops after the loaded snapshot
  private lastAck = new Map<string, { seq: number; rev: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly sockets = new Map<WebSocket, string>();  // socket -> clientId

  constructor(private docId: string, private text: string,
              private rev: number, private readonly snapshotRev: number,
              private db: Pool, private compactor: Compactor) {}

  onOp(ws: WebSocket, m: { clientId: string; clientSeq: number; baseRev: number; op: Op }) {
    // serialise per document: no interleaving across awaits
    this.queue = this.queue.then(() => this.handle(ws, m)).catch((e) => this.onError(ws, e));
    return this.queue;
  }

  private async handle(ws: WebSocket, m: { clientId: string; clientSeq: number; baseRev: number; op: Op }) {
    const prev = this.lastAck.get(m.clientId);
    if (prev && m.clientSeq <= prev.seq) {      // retry: re-ack, do not re-apply
      return ws.send(JSON.stringify({ t: 'ack', clientSeq: m.clientSeq, rev: prev.rev }));
    }
    if (m.baseRev < this.snapshotRev) {          // too far behind to transform
      return ws.send(JSON.stringify({ t: 'snapshot', rev: this.rev, text: this.text }));
    }
    let op: Op | null = m.op;
    for (const h of this.history) {              // every op the client had not seen
      if (h.rev <= m.baseRev || !op || !h.op) continue;
      op = transform(op, h.op, m.clientId < h.clientId);  // same tie-break as clients
    }
    const rev = this.rev + 1;
    const r = await this.db.query(
      'INSERT INTO doc_ops (doc_id, rev, client_id, client_seq, ops) VALUES ($1,$2,$3,$4,$5) ' +
      'ON CONFLICT DO NOTHING RETURNING rev',
      [this.docId, rev, m.clientId, m.clientSeq, JSON.stringify(op)]);
    if (r.rowCount === 0) throw new LostOwnershipError(this.docId);  // fenced: resync

    this.text = apply(this.text, op);           // commit in memory only after durable append
    this.rev = rev;
    this.history.push({ rev, clientId: m.clientId, op });
    this.lastAck.set(m.clientId, { seq: m.clientSeq, rev });

    ws.send(JSON.stringify({ t: 'ack', clientSeq: m.clientSeq, rev }));
    for (const [s, cid] of this.sockets) {
      if (s !== ws) s.send(JSON.stringify({ t: 'op', rev, clientId: m.clientId, op }));
    }
    if (rev - this.snapshotRev >= 500) this.compactor.schedule(this.docId, rev, this.text);
  }
}`,
      },
      explanation: `**What was wrong and how it is fixed:**
- **No transformation:** ops were applied at stale positions, so replicas diverged. The server now transforms the incoming op against every committed op after \`baseRev\`, using the same deterministic tie-break as the clients.
- **Async interleaving:** two \`onOp\` calls could interleave around the \`await\`, so broadcast order differed from rev order. A per-document promise queue serialises handling.
- **Retries applied twice:** \`(clientId, clientSeq)\` dedup re-acks with the original rev, and the unique constraint in the log backs this up.
- **Echo instead of ack:** the author received its own op as a remote op and applied it twice. The author now gets an \`ack\` and everyone else gets the op.
- **Write amplification:** rewriting the whole body per keystroke (40K rows/s) is replaced by an append-only \`doc_ops\` row per op, with snapshots every 500 revisions from a background compactor.
- **Split brain:** \`ON CONFLICT DO NOTHING\` on \`(doc_id, rev)\` fences a stale owner, which drops the doc instead of forking history.
- **Hopelessly stale clients:** if the client's base is older than the snapshot, it gets a fresh snapshot to rebase onto.`,
      followUps: [
        {
          q: 'The history array grows forever while a popular doc stays open for a week. How do you bound memory without breaking clients that reconnect with an old baseRev?',
          a: 'After each snapshot, keep only ops newer than the minimum `baseRev` still referenced by any connected client, with a floor of the last snapshot. Disconnected clients are bounded by a policy such as "resync by op replay if fewer than 5,000 revs behind, otherwise snapshot + rebase", and their older ops come from the `doc_ops` table instead of memory. Track per-socket last-acked rev so you know the low-water mark. Memory becomes O(ops in the active window), not O(doc lifetime).',
        },
        {
          q: 'Now make it distributed: 100 collab servers. What guarantees that all ops for a document reach the same DocSession, and what happens during a deploy?',
          a: 'Gateways route by consistent hash of `doc_id`, and the owner holds a lease (etcd/ZooKeeper/Redis with an epoch). On deploy, drain: the old owner stops accepting ops, flushes, releases the lease and tells clients to reconnect. The new owner loads snapshot + log tail. If an old owner is paused rather than drained, its next insert hits an existing `(doc_id, rev)` and gets 0 rows, so it gives up. Clients keep pending ops and resend them with their last acked rev, and the new owner transforms them as usual.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-modern-iq-1',
      difficulty: 'hard',
      question:
        'Design the live-streaming backend for an IPL final on an Indian OTT app: one match, about 12 language feeds, and a forecast peak of 60 million concurrent viewers, mostly on mobile.',
      context:
        'Interviewer adds: "Assume we already have a VOD platform. I care about the live path, the CDN plan and what happens at the toss."',
      whatInterviewerLooksFor: [
        'Sizes egress and edge request rate before drawing boxes',
        'Redundant ingest and a GOP-aligned ABR ladder that runs faster than real time',
        'Origin protection through shield-tier request collapsing and correct cache TTLs',
        'Multi-CDN / ISP-cache strategy and a plan for spikes (pre-warm, degrade)',
        'Explicit latency target and the segment/LL-HLS choice that delivers it',
      ],
      modelAnswer: `**Clarify:** latency target (say 8 s; < 5 s if fantasy/betting overlays matter), DRM, DVR window, ads (SSAI at over breaks), devices (90%+ mobile).

**Numbers:** with a mobile-heavy ladder the average is ~1 Mbps, so 60M × 1 Mbps ≈ **60 Tbps** egress. With 4 s segments and one playlist refresh per segment: 60M × 2 ÷ 4 = **30M edge req/s**. That is beyond a single CDN, so plan **multi-CDN plus ISP-embedded caches** and commit capacity with each CDN weeks ahead.

**Pipeline:**
- Two contribution feeds over SRT into two ingest PoPs with identical timestamps → seamless failover.
- Live transcoder: decode once and encode 1080p/720p/480p/360p/240p with 2 s aligned GOPs. Each feed is 12 languages × 5 renditions = 60 encodes, which is small. The cost lives in delivery, not transcoding.
- Packager: CMAF segments + HLS/DASH manifests, DRM, SCTE-35 ad markers.
- Origin in two regions → **shield tier with collapsed forwarding** → CDNs. Origin load is renditions × objects × shields ≈ tens of req/s, independent of audience.
- Playlists cached ~1 s; segments immutable.

**Player:** start at a conservative rendition, ABR upward, and use CDN steering (a client-side or server-side decision service that moves sessions off a degrading CDN).

**Spike plan:** forecast a concurrency ladder from history, **pre-scale** APIs (login, entitlement, playback-URL signing) before the match, and scale on concurrency, not CPU. Keep panic-mode flags that turn off recommendations and personalisation, and cap the top rendition to protect the CDN. Load-test with synthetic viewers on game days.

**Latency:** 4 s segments with a 3-segment buffer gives ~15 s. For < 5 s, use LL-HLS parts of ~0.5–1 s with blocking playlist reload, which requires CDN support.

**Observability:** per-CDN/ISP/region rebuffer ratio, startup time and error rate from client beacons. These, not server CPU, are the SLIs.`,
      followUps: [
        {
          q: 'One CDN starts returning 5xx in Maharashtra during the second innings. What happens to viewers?',
          a: 'Players report errors and rebuffering through beacons. The steering service sees one CDN × region × ISP cell degrade and moves new playlist/segment requests to the other CDNs, either by rewriting the base URL in the playlist or through a steering manifest. Players also retry the next segment on an alternate host after a single failure. Capacity on the remaining CDNs must already be committed, which is why you contract for ~1.3–1.5× peak split across vendors.',
        },
        {
          q: 'Why not just autoscale the API tier on CPU?',
          a: 'Joins arrive at 1M+/min around the toss, while instance boot plus app warm-up is ~1–2 minutes and autoscaling groups react in steps after a cooldown. By the time CPU rises and capacity arrives, the queue has already timed out. CPU is also a lagging signal. Pre-warm to the forecast ladder and treat concurrency as the input; reactive scaling only covers the error margin.',
        },
        {
          q: 'How do you make the concurrency number the business quotes trustworthy?',
          a: 'Count heartbeats (every 30–60 s) from active playback sessions, deduplicated by session id, in per-minute windows with HyperLogLog per stream/region. Exclude paused and backgrounded players. Delivery logs overcount because of retries and prefetch, so they are only a cross-check.',
        },
      ],
      pitfalls: [
        'Designing it like VOD upload/transcode and never sizing CDN egress',
        'Letting edge misses hit the origin directly (no shield / collapsing)',
        'Caching the live playlist for a long TTL',
        'Relying on reactive autoscaling for a known, scheduled spike',
      ],
    },
    {
      id: 'design-modern-iq-2',
      difficulty: 'expert',
      question:
        'Five minutes before the toss your dashboards show concurrency climbing 3M per minute, the playback-URL signing service at p99 2 s and rising, and one CDN at 85% of committed capacity. Walk me through the next ten minutes.',
      whatInterviewerLooksFor: [
        'Prioritises playback continuity over features (protect the critical path)',
        'Knows pre-built levers: panic mode, bitrate caps, CDN shifting, admission',
        'Avoids actions that amplify load (retry storms, cache busting)',
        'Communicates a decision order with expected effects and measurement',
      ],
      modelAnswer: `**Principle:** viewers already watching must keep watching. New joins come second, features come last.

**Minute 0–2: stop the bleeding on the critical path.**
- The signing service is on every join. Check whether it is CPU-bound or blocked on a dependency (entitlement DB, token KMS). Turn on **panic mode**: skip personalised rails, recommendations and watch-history writes on the home and player pages. These calls often outnumber playback calls.
- Make the signing token longer-lived (e.g. 30 min instead of 5) so existing viewers do not re-sign during the spike. Cache entitlement per user for the match.
- Make clients back off with jitter on 5xx so retries do not amplify the load (a server-driven retry-after in the config endpoint).

**Minute 2–5: protect egress.**
- Shift a percentage of **new sessions** to the other CDNs through steering weights before the 85% CDN saturates. Moving existing sessions mid-play causes rebuffering, so do it gradually.
- Cap the top rendition (1080p → 720p) for new sessions and lower the start bitrate. About 20% of egress can come back within minutes.

**Minute 5–10: admission and scale.**
- If signing still saturates, use a **virtual waiting room** for new joins (a token queue at the edge) rather than letting everyone time out.
- Pre-provisioned warm pools absorb further load; resist cold-scaling during the spike.

**Measure after each lever:** join success rate, rebuffer ratio per CDN, and signing p99. Roll back any lever that does not move these.

**Afterwards:** the real fix is forecasting. The ladder underestimated this match, so feed the result back into the model and run the next game day at 1.5× this peak.`,
      followUps: [
        {
          q: 'Panic mode is on, but the home page still makes 14 API calls per open. What would you have built in advance?',
          a: 'A server-driven "match mode" layout. The config endpoint, cached at the CDN for ~10 s, returns a minimal home page with a hero card for the live match. The client then makes one or two calls instead of 14. Each rail has a static fallback served from the CDN, so even with the backend down the client renders cached JSON. The flags are evaluated at the edge so turning them on costs no extra origin calls.',
        },
        {
          q: 'Your fix for the signing p99 was "cache entitlement for the match". What could go wrong?',
          a: 'Revocations lag. A user whose subscription is cancelled or flagged for sharing keeps watching until the cache entry expires, and a concurrent-stream limit (2 screens) becomes unenforceable for that window. Mitigate with a bounded TTL (match duration), a push-based revocation list for fraud cases, and heartbeat-time checks that run asynchronously so they cannot block playback.',
        },
      ],
      pitfalls: [
        'Restarting or redeploying services mid-spike',
        'Moving all existing sessions to another CDN at once',
        'Scaling the database first without identifying the hot dependency',
      ],
    },
    {
      id: 'design-modern-iq-3',
      difficulty: 'hard',
      question:
        'Design live comments and reactions for a stream with 10 million concurrent viewers. Viewers should see new comments within about 2 seconds, and a reaction burst after a six should feel live.',
      whatInterviewerLooksFor: [
        'Quantifies fan-out and concludes that per-viewer delivery of every event is impossible',
        'Aggregates reactions and samples/ranks comments',
        'Uses a two-level fan-out (stream → gateway → viewers) over SSE or WebSocket',
        'Handles moderation, rate limits and reconnect/resume',
      ],
      modelAnswer: `**Numbers first.** If 0.5% of 10M viewers react in the second after a six, that is 50K reactions/s. Delivering each to 10M viewers is 5 × 10^11 messages/s, which is impossible and pointless. Comments might arrive at 5–20K/s, and a human reads about 5 per second.

**Write path:** \`POST /streams/{id}/comments\` → auth, per-user rate limit (e.g. 1 comment / 3 s), a fast safety check (blocklists, spam model) → Kafka topic partitioned by \`stream_id\` (hot streams sub-partitioned by a hash suffix) → persisted to Cassandra \`(stream_id, time_bucket)\` for replay.

**Reactions:** ingestion shards keep in-memory counts per stream per emoji and publish **one summary per second**. Gateways sum the shards' partial counts. The client animates N floating hearts proportional to the count, so the UI feels live without per-event delivery.

**Comment selection:** a ranker consumes the stream and, every ~500 ms, emits a small batch: comments from the viewer's friends (computed per gateway from a friend set), verified/creator comments, and a quality-scored sample of the rest. Everyone gets the global sample; friend comments are injected at the gateway.

**Fan-out:** viewers hold an **SSE** connection to a gateway (~100K–500K connections each, so 20–100 gateways). Each gateway subscribes **once** to the streams its viewers watch (Redis pub/sub or an internal broadcast service). Messages per second = gateways × batches, not viewers × comments.

**Resume:** events carry ids, and a reconnecting client sends \`Last-Event-ID\` to get the last few seconds from a small per-stream ring buffer. Older comments are not replayed live.

**Degradation:** at extreme load, increase the sampling ratio and the reaction aggregation window (1 s → 2 s) and disable the friends injection. The video stream is never affected.`,
      followUps: [
        {
          q: 'The streamer\'s own comment must be shown to everyone, never sampled away. How?',
          a: 'Tag events with a priority class at ingestion: creator/moderator/pinned comments bypass the sampler and go into the next batch for every gateway. Pinned comments also live in stream metadata, so late joiners and reconnects receive them in the initial state snapshot. Keep a separate per-stream rate limit for this class so a compromised creator account cannot flood every viewer.',
        },
        {
          q: 'How do you remove a comment that moderation flags 4 seconds after it was shown?',
          a: 'Emit a `comment.retracted {id}` event through the same fan-out. Clients delete the comment if it is on screen, and the replay store marks it deleted. Because the event is tiny and broadcast per gateway, it costs nothing at scale. For high-risk streams, hold comments ~1–2 s for an async classifier before release, trading a little latency for fewer retractions.',
        },
        {
          q: 'Why SSE rather than WebSocket here?',
          a: 'Delivery is overwhelmingly server-to-client. Posting a comment is a rare, ordinary HTTP POST that benefits from the standard auth, rate-limit and WAF path. SSE runs over plain HTTP/2, works through corporate proxies, and has built-in reconnect with `Last-Event-ID`. WebSocket would add a custom framing and auth path with no benefit for this traffic shape.',
        },
      ],
      pitfalls: [
        'One pub/sub message per comment per viewer',
        'Storing reactions as individual rows and counting with SELECT COUNT',
        'Putting comments on the same infrastructure path as video segments',
      ],
    },
    {
      id: 'design-modern-iq-4',
      difficulty: 'hard',
      question:
        'Design a video-conferencing product like Zoom or Google Meet: 1:1 and group calls up to 300 people, screen share, recording, and 100K concurrent meetings at peak.',
      whatInterviewerLooksFor: [
        'Separates signaling from media and justifies an SFU over mesh/MCU with numbers',
        'Explains NAT traversal (STUN/TURN/ICE) and when TURN is needed',
        'Simulcast/SVC and per-subscriber adaptation; audio prioritised',
        'Meeting placement, cascading across regions, and recording design',
      ],
      modelAnswer: `**Requirements:** < 150 ms one-way in-region, join < 3 s, audio over video, enterprise firewalls, recordings within minutes of meeting end.

**Topology:** mesh is fine for 1:1 (P2P, falling back to an SFU when ICE fails). For groups, mesh needs N−1 uploads (9 × 1.5 Mbps = 13.5 Mbps in a 10-person call), which mobile uplinks cannot sustain. An MCU decodes and re-encodes everything, which is expensive and adds 100+ ms. **SFU** forwards packets: each client uploads one simulcast set (~2.15 Mbps) and downloads only what it shows.

**Components:**
- **Meeting service:** REST for scheduling, WebSocket signaling for join/SDP/ICE/mute. Room state lives in memory with a Redis copy.
- **SFU fleet** per region, scaled on egress. 100K meetings × ~28 Mbps ≈ 2.8 Tbps → ~470 boxes at 6 Gbps each, plus N+1 per AZ.
- **STUN/TURN** with anycast, TURN over UDP and TLS/443, and ephemeral HMAC credentials.
- **Recorder bots, PSTN gateway** (an audio mixer, MCU-style at the edge), chat over the signaling channel.

**Placement:** assign the meeting to the least-loaded SFU in the first joiner's region (sticky via Redis NX). Cross-region participants connect to their local SFU, and **SFUs cascade** over the backbone so each stream crosses the ocean once.

**Adaptation:** simulcast layers, transport-cc bandwidth estimates, per-subscriber layer choice with hysteresis, keyframe-only switching, Last-N video for large rooms (300 people → video for the ~9 active speakers, audio for the rest).

**Recording:** a hidden subscriber writes per-participant tracks to object storage. A post-meeting job composites the layout and runs transcription. Retention follows the tenant's policy.

**Failure:** if an SFU dies, clients detect the loss of media/DTLS, perform an **ICE restart** through signaling, and the meeting is reassigned. Expect a 2–5 s glitch. Signaling reconnects with a session token so participants keep their identity.`,
      followUps: [
        {
          q: 'Your 300-person all-hands has 290 people with cameras off but everyone is unmuted by accident. What protects the SFU and the clients?',
          a: 'Audio has its own Last-N: the SFU forwards only the top ~3 audio streams by audio level (read from the RTP header extension), so clients never mix 290 streams. Server-side mute-on-entry for meetings above a size threshold, and host controls, deal with the human side. The SFU still receives 290 audio streams (~40 kbps each, ~12 Mbps), which is cheap. Downstream fan-out was the danger, and Last-N removes it.',
        },
        {
          q: 'An enterprise customer requires that media never leaves the EU. What changes?',
          a: 'Pin the meeting\'s SFU, TURN, recorder and storage to EU regions based on the tenant setting, and disable cascading to non-EU SFUs. Non-EU participants connect to the EU SFU directly at higher latency. Signaling metadata and recordings stay in EU storage with EU keys. Routing control-plane calls through a global service is fine only if it holds no media and no personal data beyond what policy allows.',
        },
      ],
      pitfalls: [
        'Routing media through the WebSocket signaling server',
        'Transcoding in the SFU for every subscriber',
        'Saying "use TURN for everyone"; TURN is the expensive fallback',
      ],
    },
    {
      id: 'design-modern-iq-5',
      difficulty: 'expert',
      question:
        'In a 12-person call, participants on mobile data in tier-2 cities report frozen video every few seconds while audio stays fine. Desktop users on office Wi-Fi are fine. Debug it and fix the design.',
      whatInterviewerLooksFor: [
        'Reads the symptom: audio fine + video freezing = video layer/keyframe/BWE problem, not connectivity',
        'Knows simulcast, bandwidth estimation, PLI/keyframe behaviour and their failure modes',
        'Proposes measurable fixes with hysteresis and per-subscriber caps',
        'Uses client stats (getStats) and SFU metrics to confirm',
      ],
      modelAnswer: `**Read the symptom.** Audio survives, so ICE, DTLS and the path work. Periodic video freezes on variable mobile links point to one of three things:

1. **Layer oscillation.** Bandwidth estimates on 4G swing; if the SFU switches layers up as soon as the estimate rises, it overshoots, causes loss, drops back, and each switch needs a keyframe. While waiting for the keyframe the subscriber's video freezes.
2. **Keyframe starvation.** Each switch sends a PLI to the publisher. With 11 subscribers switching, the publisher gets many PLIs; if the SFU rate-limits them (correctly), some subscribers wait 1–2 s for the next keyframe.
3. **Uplink side.** The publisher's own simulcast high layer collapses on its uplink, and subscribers pinned to it freeze.

**Confirm with data:** client \`getStats()\` (framesDropped, freezeCount, pliCount, available outgoing/incoming bitrate, qualityLimitationReason) and SFU per-subscriber layer-switch counts. A high switch rate per minute on the affected users confirms oscillation.

**Fixes:**
- **Hysteresis:** switch down immediately, switch up only after the estimate is stable for ~3–5 s with 15% headroom.
- **Viewport caps:** a thumbnail never needs more than the 180p layer, which removes most switching for gallery tiles.
- **Temporal layers** (VP8/VP9/AV1 SVC): drop frame rate (30 → 15 fps) before resolution. This needs no keyframe, so it degrades smoothly.
- **Keyframe management:** coalesce PLIs per publisher layer (one per ~500 ms) and cache the last keyframe for late joiners where the codec allows.
- **Publisher side:** let the client drop its top simulcast layer when \`qualityLimitationReason=bandwidth\`.

**Measure:** freeze count per participant-minute and switches per minute, before and after, segmented by network type.`,
      followUps: [
        {
          q: 'Why does audio usually survive when video freezes on the same link?',
          a: 'Opus audio is ~20–50 kbps with in-band FEC and a jitter buffer, so it fits and self-heals within a congested link. Senders and SFUs also prioritise it and never drop it to adapt. Video is 10–50× larger and has inter-frame dependencies: losing part of a frame corrupts everything until the next keyframe, and the receiver deliberately freezes rather than showing broken frames.',
        },
        {
          q: 'Would switching these users to TCP via TURN/TLS help?',
          a: 'Usually it makes things worse. TCP turns loss into head-of-line blocking and retransmission delay, so jitter grows and the jitter buffer either stalls or drops late frames. TURN/TLS is a reachability fallback for networks that block UDP, not a quality fix. On lossy mobile links, UDP with NACK/FEC and good bandwidth estimation is better.',
        },
      ],
      pitfalls: [
        'Blaming the TURN server or the signaling server',
        'Raising the jitter buffer to seconds (kills interactivity)',
        'Switching the whole meeting to lower quality for one bad link',
      ],
    },
    {
      id: 'design-modern-iq-6',
      difficulty: 'expert',
      question:
        'A meeting has 6 people in Bengaluru, 4 in London and 3 in Virginia. Where does the media go? Then design cloud recording with a per-speaker transcript available within 5 minutes of the meeting ending.',
      whatInterviewerLooksFor: [
        'Compares single-SFU placement with cascaded SFUs using latency numbers',
        'Understands the backbone relay and its cost/latency benefits',
        'Recording via a subscriber bot with per-track storage, not an MCU',
        'Transcript pipeline sized to finish in minutes and robust to bot failure',
      ],
      modelAnswer: `**Single SFU in Mumbai:** Bengaluru users get ~20 ms to the SFU, London ~120–140 ms one-way, Virginia ~180–220 ms. London↔Virginia traffic goes via Mumbai, so a London speaker reaches Virginia in ~300+ ms. That is noticeable.

**Cascaded SFUs:** each participant connects to the nearest SFU (Mumbai, London, Virginia). Each SFU forwards its local publishers once to each other SFU over the provider backbone (relay links), and each SFU fans out to its local subscribers. London → Virginia becomes ~40 ms + ~70 ms backbone. The public internet is used only for the last mile. Trade-offs: more complex state (which SFU has which track and which layers) and inter-region transfer cost, which is still cheaper than each subscriber pulling across oceans. Layer selection happens at each edge SFU, while the relay carries the layers any remote subscriber needs.

**Recording:**
- A recorder bot joins on the SFU nearest the storage region (or one per SFU for very large meetings) as a hidden subscriber with the highest needed layers.
- It writes **per-participant tracks** (Opus/VP8 in WebM or raw RTP dumps) to object storage in ~10 s chunks, so a bot crash loses at most one chunk and a replacement bot resumes.
- Track metadata (participant id, start offset) goes to a DB for alignment.

**Transcript in < 5 min:** per-speaker audio tracks make diarisation trivial. Stream audio chunks to ASR **during** the meeting (near real time), so at the end only the last few minutes need processing. Then merge per-speaker segments by timestamp into one transcript. Compositing the video layout runs as a separate, slower job that the transcript does not wait for.

**Policy:** recording consent banner, tenant retention, and region pinning of the storage bucket.`,
      followUps: [
        {
          q: 'The Virginia SFU crashes mid-meeting. What do the Virginia participants and the other SFUs experience?',
          a: 'Virginia clients lose media and fall back to the signaling channel, which reassigns them, typically to another Virginia SFU or the next closest region, with an ICE restart in ~2–5 s. The London and Mumbai SFUs see their relay to Virginia drop and remove its tracks. When the clients republish, the new SFU announces their tracks and relays rebuild. The recorder sees a gap for those tracks, which is acceptable if marked in metadata so alignment does not shift.',
        },
        {
          q: 'E2EE is enabled for this meeting. What happens to your recording design?',
          a: 'The server-side recorder receives only encrypted frame payloads. It can store them, but it cannot transcribe or composite without keys. Options: disable cloud recording under E2EE (common product choice); record locally on a host client that has the keys; or make the recorder an explicit, visible participant that receives keys, which users must consent to because it weakens the E2EE guarantee.',
        },
      ],
      pitfalls: [
        'Placing the SFU in the "middle" region and calling it done',
        'Recording through a composited MCU stream, which loses per-speaker tracks',
        'Starting transcription only after the meeting ends',
      ],
    },
    {
      id: 'design-modern-iq-7',
      difficulty: 'hard',
      question:
        'Design ChatGPT: users chat with a large model, see the answer stream token by token, and can come back to any past conversation. Assume ~100M DAU and a GPU fleet we operate ourselves.',
      whatInterviewerLooksFor: [
        'Names LLM-specific SLIs: TTFT, inter-token latency, tokens/s per GPU, cost per token',
        'Streaming protocol choice and resumability across reconnects',
        'Conversation data model and context-window handling',
        'Inference layer: continuous batching, KV cache, routing, admission control',
        'Token-based rate limits and tiering',
      ],
      modelAnswer: `**Scope:** text chat, streaming, history, stop/regenerate, free and paid tiers. Out of scope: training, tools/RAG, images.

**Estimation:** 100M DAU × ~15 prompts/day ≈ 1.5B/day ≈ 17K/s on average, so plan for ~20K/s at peak. At 300 output tokens and 50 tok/s, each stream lasts 6 s, giving **120K concurrent streams**. KV for a 70B GQA model is 320 KiB/token, so ~350 sequences per 8×H100 node → **~340 nodes**.

**API:** \`POST /conversations/{id}/messages\` returns SSE deltas, with \`GET /messages/{id}/stream?Last-Event-ID\` to resume and \`POST /messages/{id}/cancel\` to stop.

**Data:** conversations partitioned by user, messages partitioned by conversation and clustered by seq (Cassandra/DynamoDB), with status, token counts and parent id for regenerate. A usage ledger feeds billing.

**Flow:** gateway (auth, request limits) → chat service (persist user message idempotently, build context, reserve tokens, moderate input) → **inference router** (tier queues, prefix affinity, admission) → model replicas (vLLM/TensorRT-LLM, continuous batching, paged KV, prefix cache) → token stream → **per-message buffer** (Redis Stream) → SSE to client. The final message is persisted, and unused tokens are refunded.

**Key decisions:**
- **Generation decoupled from the socket:** reloads, network switches and API-tier deploys resume from the buffer.
- **Context:** re-send history each turn within the window. Trim in stable chunks plus summaries so prefix-cache hits survive.
- **Scheduler signals:** queue depth and free KV blocks, not CPU.
- **Overload:** shed free tier first (smaller model, lower max_tokens, 429 with Retry-After). Paid tier keeps its SLO.
- **Safety:** input moderation is synchronous and cheap; output moderation runs on the stream and can cut it off.

**Multi-region:** chat and storage are regional with global user routing. GPU pools are global and the router can send overflow to a region with spare capacity, accepting ~100–200 ms extra TTFT.`,
      followUps: [
        {
          q: 'Your conversation store is fine, but listing a heavy user\'s 20,000 conversations in the sidebar is slow. Fix it.',
          a: 'Serve the sidebar from a dedicated table keyed by `user_id` with clustering `updated_at DESC`, holding only title, id and timestamp, and paginate with a cursor of `(updated_at, conv_id)`. Updating `updated_at` means delete + insert in Cassandra (clustering key change) or a GSI in DynamoDB. Titles are generated asynchronously after the first exchange. Never derive the list by scanning messages.',
        },
        {
          q: 'Regenerate creates a second assistant answer. How is that modelled and what context does the next turn use?',
          a: 'Messages form a tree through `parent_id`: the user message has two assistant children, and the conversation stores the currently selected leaf. Building context walks from the selected leaf to the root, so the next turn uses only the visible branch. The UI can switch branches by updating the selected leaf. Billing records both generations.',
        },
        {
          q: 'Where does prompt injection or abuse detection sit in this flow?',
          a: 'Cheap synchronous classifiers on input (policy and abuse) before reserving GPU, and a streaming output classifier that can stop the generation and replace the partial answer. Per-account anomaly detection (token velocity, jailbreak patterns) runs asynchronously on the usage ledger and feeds the rate limiter with lower limits or blocks. Keep these off the token hot path except for the stop signal.',
        },
      ],
      pitfalls: [
        'Request-based rate limits and a plain HTTP response that waits for the whole answer',
        'Autoscaling GPUs on CPU utilisation',
        'Storing the "conversation state" on the model server',
        'No answer for what happens when the connection drops mid-stream',
      ],
    },
    {
      id: 'design-modern-iq-8',
      difficulty: 'expert',
      question:
        'Your LLM fleet shows ~35% GPU utilisation at peak, yet p95 time-to-first-token is 8 seconds and users complain about stutters mid-answer. Diagnose and fix.',
      whatInterviewerLooksFor: [
        'Separates queueing delay, prefill cost and decode interference',
        'Knows static vs continuous batching, KV-memory limits, and chunked prefill / disaggregation',
        'Uses the right metrics (queue time, batch size, KV utilisation, prefill tokens per step)',
        'Proposes fixes in order of impact and verifies each one',
      ],
      modelAnswer: `**Decompose TTFT** = queue wait + prefill time + first decode step. Instrument each. Low utilisation together with a high TTFT almost always means **scheduling**, not hardware shortage.

**Likely causes:**
1. **Static batching:** batches launch and wait for their longest member. New arrivals wait for the whole batch, so the GPU idles while short sequences have finished. **Fix:** continuous batching (vLLM, TensorRT-LLM in-flight batching), where sequences join and leave every step.
2. **KV pre-allocation:** each request reserves KV for \`max_tokens\` = 8K, so a node admits few sequences and the batch stays small while HBM sits "full" but unused. **Fix:** paged KV blocks, a lower default \`max_tokens\`, and fp8 KV if quality allows.
3. **Long prefills stalling decode** (the mid-answer stutter): a 30K-token document prompt monopolises a step and every streaming user pauses. **Fix:** chunked prefill with a token budget per step, or a separate prefill pool (disaggregation).
4. **Poor routing:** round-robin ignores which replica has the conversation's prefix cached, so every turn re-prefills the full history. **Fix:** prefix-affinity routing with bounded load. This also cuts prefill FLOPs dramatically for multi-turn chat.
5. **Head-of-line queues:** one FIFO across tiers and request sizes. **Fix:** per-tier queues with weighted fairness, and shortest-expected-job hints for tiny prompts.

**Verify:** after each change, watch batch size (should rise), KV utilisation (should be high and stable), queue time p95, inter-token latency p99 and tokens/s per GPU.

**Expected result:** continuous batching plus paging typically multiplies throughput several times on the same hardware. Chunked prefill removes the stutters. Prefix routing lowers TTFT for long conversations.`,
      followUps: [
        {
          q: 'After the fixes, utilisation is 80% and TTFT is good, but inter-token latency p99 doubled. Why, and what knob trades it back?',
          a: 'Larger batches mean each decode step processes more sequences and, past the memory-bound regime, steps get longer, so every user\'s per-token time rises. Cap the maximum batch size or the tokens per step, and set the chunked-prefill budget so prefill slices do not stretch steps beyond the ITL SLO (e.g. 50 ms). This is the throughput vs latency dial; tune it per tier (interactive chat vs batch API).',
        },
        {
          q: 'Would speculative decoding help this fleet?',
          a: 'It helps latency at low-to-moderate batch sizes: a small draft model proposes k tokens and the big model verifies them in one pass, often giving 2–3× faster decoding when acceptance rates are high. At high batch sizes the GPU is already busy, so the extra verify work competes for compute and gains shrink. Use it on latency-sensitive tiers or off-peak, not as a capacity fix.',
        },
      ],
      pitfalls: [
        'Buying more GPUs before fixing scheduling',
        'Measuring only end-to-end latency instead of TTFT vs ITL',
        'Raising max batch size without an inter-token SLO',
      ],
    },
    {
      id: 'design-modern-iq-9',
      difficulty: 'hard',
      question:
        'Design the quota and fairness layer for an LLM API used by free users, paid users and enterprise API keys. A single request can cost anywhere from 50 to 100,000 tokens.',
      whatInterviewerLooksFor: [
        'Uses tokens (and maybe concurrency) as the unit, not requests',
        'Reserve-then-reconcile to handle unknown output length',
        'Multiple limit dimensions: per key, per org, per model, global capacity',
        'Fair scheduling across tiers and clear client signals (429 + headers)',
      ],
      modelAnswer: `**Units.** Limit three things: **tokens per minute** (cost), **requests per minute** (abuse/overhead) and **concurrent streams** (KV memory, since one client holding 200 long streams can starve a node). Enterprise contracts add monthly token budgets.

**Admission algorithm:**
1. Count prompt tokens with the model's tokenizer at the gateway.
2. Reserve \`prompt + max_tokens\` atomically in token buckets: per key, per org, per model. A Redis Lua script checks all buckets and deducts only if all pass.
3. On completion, refund \`max_tokens − produced\`. The usage ledger records actual tokens for billing.
4. Concurrency: \`INCR\` an inflight counter with a TTL heartbeat and \`DECR\` on finish, so crashed streams do not leak slots.

**Response:** 429 with \`retry-after\` and headers such as \`x-ratelimit-remaining-tokens\` and \`x-ratelimit-reset-tokens\`, so SDKs can back off precisely.

**Encouraging honest max_tokens:** reservations are based on it, so clients that ask for 32K and use 300 tie up their own budget. That pushes them to set realistic values.

**Fairness at the GPU (separate from quotas):** quota says *may* run; the scheduler decides *when*. Use per-tier queues with weighted fair queueing (e.g. enterprise 60%, paid 30%, free 10% when contended, work-conserving when idle), and within a tier, per-org round robin so one org's batch job cannot occupy the queue. Under overload, shed free first.

**Scale:** Redis per region; global enterprise budgets reconcile asynchronously from regional counters with small overshoot allowances. Hot orgs get a local token cache (lease 10K tokens at a time) to avoid a Redis call per request.`,
      followUps: [
        {
          q: 'An enterprise customer complains: "we were rate limited but our dashboard shows we used only 40% of our TPM." What is going on?',
          a: 'Reservations. They send `max_tokens: 4096` but generate ~600 on average, so in-flight reservations hold ~7× actual usage until each stream finishes and refunds. With many concurrent requests the bucket appears empty while billed usage is low. Fix: show reserved vs used on the dashboard, advise realistic `max_tokens`, or reserve a predicted output length (from the key\'s history) and charge any overage post-hoc with a small allowed debt.',
        },
        {
          q: 'How do you count tokens at the gateway without loading the model?',
          a: 'Tokenizers (BPE vocab files) are small and fast and run on CPU in-process. Counting a prompt is microseconds to milliseconds. For multimodal inputs, use the documented per-image/per-tile token formula. Because reservations are reconciled with the engine\'s authoritative counts at the end, small gateway estimation errors only affect admission, not billing.',
        },
      ],
      pitfalls: [
        'Requests-per-minute only',
        'Charging after completion, which lets parallel bursts through',
        'Mixing quota enforcement with GPU scheduling fairness',
      ],
    },
    {
      id: 'design-modern-iq-10',
      difficulty: 'hard',
      question:
        'Design Google Docs: multiple users edit the same document at the same time, see each other\'s cursors, and can view version history.',
      whatInterviewerLooksFor: [
        'Explains why naive last-write-wins or locking fails and picks OT or CRDT deliberately',
        'Per-document sequencer with sticky routing and durable op log + snapshots',
        'Client protocol: optimistic apply, one in-flight op, ack/transform',
        'Presence handled separately as ephemeral state',
        'Failure handling: reconnect/resync, owner failover with fencing',
      ],
      modelAnswer: `**Requirements:** concurrent rich-text editing, < 300 ms remote echo, convergence, no lost edits, cursors/presence, comments, history, sharing. Out of scope: spreadsheets and offline-first (discuss later).

**Why not simpler:** paragraph locks feel broken when two people type in one paragraph. Last-write-wins on the whole doc loses edits. We need operation-level merging.

**Choice: server-sequenced OT.** We need a server anyway for permissions, durability and fan-out, and a sequencer per doc makes OT simple (TP1 only).

**Client:** apply locally immediately; send one op at a time with \`baseRev\` and \`clientSeq\`; buffer further edits until ack; transform incoming remote ops against the in-flight and buffered ops.

**Server:**
- Gateways route \`doc_id\` → collaboration server (consistent hash + lease). One owner per doc.
- Owner: dedupe → transform against ops since \`baseRev\` → append \`(doc_id, rev)\` to the op log (Spanner/Postgres/Bigtable) → ack the author → broadcast to the others.
- Snapshots every ~500 ops; open = snapshot + tail.

**Numbers:** 1M active typists × 5 batched ops/s = 5M msgs/s → ~100 collab servers. The op log is ~500 MB/s at peak, so compaction is mandatory.

**Presence:** cursor/selection messages over the same socket, throttled to ~10/s, never persisted, expire on heartbeat loss, transformed against ops so they do not drift.

**History:** snapshots + ops grouped by author and time window, with named versions. Restore = a new op that sets content (history stays append-only).

**Failures:** a client reconnects with its last acked rev and resends pending ops. The owner dies → lease expires → new owner loads snapshot + log. A stale owner is fenced by the \`(doc_id, rev)\` primary key.

**Permissions:** checked at session join and on every op (role can change mid-session). Commenters can only send comment ops.`,
      followUps: [
        {
          q: 'How would comments stay attached to the right text while people edit around them?',
          a: 'A comment\'s anchor is a range `(start, end)` stored with the rev it was created at. Every op is applied to anchors via the same transform rules used for cursors: an insert before the range shifts it, and an insert inside extends it. If the anchored text is fully deleted, the comment becomes "orphaned" but stays in the thread. With a CRDT, anchors reference character ids, which never move, so the problem largely disappears.',
        },
        {
          q: 'Could you avoid the single owner per document entirely?',
          a: 'Yes, with a CRDT: any server or client can accept edits and merges commute, so servers become stateless relays plus storage. The cost is per-character ids and tombstones (memory and payload overhead), garbage collection that needs coordination, and harder-to-enforce invariants such as per-op permission checks and size limits. For a server-centric product, one owner per doc is simple and the per-doc load (≤ 100 editors) fits easily on one process.',
        },
      ],
      pitfalls: [
        'Locking paragraphs or the whole document',
        'Persisting the full document body per keystroke',
        'Persisting cursor movements in the op log',
        'Ignoring tie-breaks and concurrent-op transformation',
      ],
    },
    {
      id: 'design-modern-iq-11',
      difficulty: 'expert',
      question:
        'Your team wants to replace the OT engine of your docs product with a CRDT library (e.g. Yjs) to support offline editing on mobile. Make the case for and against, and tell me what you would actually ship.',
      whatInterviewerLooksFor: [
        'Understands why OT struggles with long offline divergence',
        'Knows CRDT costs: metadata, tombstones, GC, interleaving anomalies, migration',
        'Considers server-side concerns: permissions, validation, history, search indexing',
        'Gives a staged, low-risk migration plan',
      ],
      modelAnswer: `**For CRDT:**
- Offline for hours means a client returns with hundreds of ops based on an old rev. OT must transform them against thousands of server ops (O(n × m)) and rebasing rich-text intent is fragile. CRDT merges are order-independent by construction.
- Servers become relays plus storage, with no per-doc transform logic. Scaling and failover get simpler.
- Libraries like Yjs are mature, have binary update encoding, and support awareness (presence) protocols.

**Against / costs:**
- **Metadata:** every character carries an id. Deleted text becomes tombstones. Yjs is compact (run-length encoding of sequential inserts), but large heavily edited docs still grow, and GC needs care when offline clients may still reference old items.
- **Semantics:** some algorithms interleave concurrent inserts at the same spot. Rich-text formatting merges (overlapping bold/italic spans) need a model such as Peritext-style marks.
- **Server control:** validation (size limits, schema, permissions per op) means decoding updates on the server. Search indexing and history now consume CRDT updates instead of simple ops.
- **Migration:** every existing document needs converting, and old clients speak OT.

**What I would ship:**
1. Keep the server authoritative. Clients send CRDT updates to a doc service that validates, persists (update log + periodic compacted state) and relays them. This retains permissions, audit and history.
2. Migrate lazily: convert a doc to CRDT state on first open by a new client, with a feature flag per doc and a dual-read period.
3. Mobile first, where offline matters most; web follows.
4. Measure doc size growth, merge time, and divergence bugs (hash replicas periodically and compare).

**Bottom line:** CRDT for offline-heavy clients is worth it, but as a data structure inside a server-mediated architecture, not a move to pure P2P.`,
      followUps: [
        {
          q: 'How do you detect that two replicas silently diverged in production?',
          a: 'Periodically compute a hash of the rendered document (or of the CRDT state vector plus content) at a given rev or state vector on each client, and send it to the server, which compares it with its own. A mismatch triggers a forced reload from server state and an error report with the op history for debugging. Run fuzz tests offline that replay random concurrent op sequences across N simulated replicas and assert equal output.',
        },
        {
          q: 'An offline client returns after 3 days with edits to a section someone else deleted. What does the user see?',
          a: 'With a CRDT, the inserts merge structurally: text inserted inside a deleted range survives as orphaned characters next to the tombstoned neighbours, which can look odd. Products usually surface this as "your offline edits were merged" with highlighting, or keep the conflicting section as a suggestion the user can accept. Convergence is guaranteed; good intent is a UX decision on top of it.',
        },
      ],
      pitfalls: [
        'Claiming CRDTs have no overhead or no conflicts',
        'Dropping the server and losing permission checks and audit',
        'Big-bang migration of every document',
      ],
    },
    {
      id: 'design-modern-iq-12',
      difficulty: 'expert',
      question:
        'A company-wide all-hands agenda doc is opened by 3,000 employees at 10:00; 40 of them edit it live. The collaboration server owning that doc hits 100% CPU and edits lag by 10 s. What happened and how do you redesign for it?',
      whatInterviewerLooksFor: [
        'Identifies broadcast fan-out and presence, not OT, as the hot work',
        'Separates editors from viewers and sequencing from distribution',
        'Throttles and aggregates presence; batches broadcast',
        'Keeps the single-sequencer model while offloading everything else',
      ],
      modelAnswer: `**What happened.** The owner does three kinds of work:
- **Sequencing:** 40 editors × ~5 ops/s = 200 ops/s, which is trivial.
- **Broadcast:** each committed op goes to 3,000 sockets → 600K messages/s from one process.
- **Presence:** 3,000 users each sending cursor/scroll updates at ~10/s is 30K msgs/s in, and broadcasting each to everyone is quadratic (30K × 3,000 = 90M/s).

Presence and fan-out, not OT, saturated the CPU.

**Redesign:**
1. **Viewers off the owner:** sessions without edit intent connect to a **read fan-out tier** (stateless relays subscribed to the doc's committed-op stream). The owner publishes each op once; relays fan out to ~1K sockets each. An editor who starts typing is upgraded to an editing session on the owner.
2. **Batch broadcasts:** coalesce committed ops into frames every ~50 ms. That is 20 frames/s per relay instead of one message per op.
3. **Presence aggregation:** show cursors only for active editors (the 40), not viewers. Show viewers as a count and a list of avatars refreshed every few seconds. Throttle editor cursors to ~5–10/s, last-value-wins.
4. **Admission:** above ~100 editors, new joins become viewers or commenters (matching how Google limits concurrent sessions per file).
5. **Owner isolation:** move this hot doc to a dedicated or less-loaded collab server (bounded-load consistent hashing), so other docs on the same box stop lagging.

**Result:** the owner handles ~200 ops/s plus 40 editors' presence, a few percent of one core. Relays scale horizontally with viewers.`,
      followUps: [
        {
          q: 'Viewers on the relay tier see edits a little later than editors. Is that a correctness problem?',
          a: 'No. Viewers receive the same committed ops in rev order, just ~50–100 ms later because of batching and one extra hop. Convergence holds because they apply the identical sequence. The relay must preserve per-doc order (one ordered subscription per doc) and give reconnecting viewers missing revs or a snapshot. Only an editor needs the low-latency path to the sequencer.',
        },
        {
          q: 'How would you catch this hot-doc pattern before users complain?',
          a: 'Per-doc metrics: sockets per doc, broadcast msgs/s and presence msgs/s per doc, and per-op commit-to-broadcast latency, with alerts on the top-N docs per server. Automatic policy: once a doc passes ~200 sessions, switch it to relay mode and aggregated presence. Load tests should include a synthetic all-hands doc, not just many small docs.',
        },
      ],
      pitfalls: [
        'Trying to shard a single document across multiple sequencers',
        'Scaling vertically and calling it fixed',
        'Treating viewers and editors the same',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-modern-boe-1',
      question:
        'Estimate the CDN egress and edge request rate for a 60M-concurrent cricket final, and the load that should reach the origin.',
      assumptions: [
        'Rendition mix: 45% at 0.4 Mbps, 35% at 0.8 Mbps, 15% at 2 Mbps, 5% at 4.5 Mbps',
        '4 s segments; each player fetches one segment and one playlist refresh per segment',
        '6 renditions per feed; 20 shield nodes in front of the origin; request collapsing on',
      ],
      steps: [
        { label: 'Average bitrate', calc: '0.45×0.4 + 0.35×0.8 + 0.15×2 + 0.05×4.5 = 0.18 + 0.28 + 0.30 + 0.225 = 0.985 Mbps' },
        { label: 'Egress', calc: '60M × 0.985 Mbps ≈ 59.1 Tbps' },
        { label: 'Edge requests', calc: '60M × 2 objects ÷ 4 s = 30M req/s' },
        { label: 'Origin requests (one feed)', calc: '6 renditions × 2 objects ÷ 4 s × 20 shields = 60 req/s' },
        { label: 'Sanity check vs reported', calc: 'Hotstar 2019: 10 Tbps / 25.3M ≈ 0.4 Mbps avg → same order of magnitude' },
      ],
      answer: '≈ 59 Tbps of egress and ≈ 30M req/s at the edge, but only ~60 req/s per feed at the origin.',
      insight:
        'Delivery is a CDN capacity-procurement problem (multi-CDN + ISP caches, contracted weeks ahead); the origin is tiny if collapsing works. Bitrate policy is the biggest cost and capacity lever.',
      followUps: [
        {
          q: 'CDN capacity tops out at 52 Tbps across vendors. What is the cheapest lever, and is it enough?',
          a: 'Cap the top rendition at 720p for the match: the 5% at 4.5 Mbps move to 2 Mbps, so the average becomes 0.18 + 0.28 + 0.40 = 0.86 Mbps → 60M × 0.86 ≈ 51.6 Tbps. That saves ~7.5 Tbps (~13%) and just fits, but with no headroom. Add a lower start bitrate for new sessions and a further cap on 480p mobile during the peak overs to build margin.',
        },
        {
          q: 'Segments shrink from 4 s to 1 s for low latency. What changes?',
          a: 'Edge requests scale with 1 ÷ segment duration: 60M × 2 ÷ 1 = 120M req/s, 4× higher, while egress barely changes. Per-request overhead (TLS, headers, logging) and CDN request pricing now matter, and shield/origin traffic also rises 4×. This is why LL-HLS uses partial segments with blocking playlist reload and preload hints, instead of naive 1 s segments.',
        },
      ],
    },
    {
      id: 'design-modern-boe-2',
      question:
        'Size the SFU fleet for 100K concurrent meetings of 10 participants each, with simulcast and a speaker-plus-thumbnails layout.',
      assumptions: [
        'Simulcast upload layers: 1.5 + 0.5 + 0.15 Mbps',
        'Each subscriber receives 1 HD speaker (1.5 Mbps), 8 thumbnails (0.15 Mbps each), 3 audio streams (40 kbps each)',
        'One SFU box sustains ~6 Gbps of egress (60% of a 10 GbE NIC)',
      ],
      steps: [
        { label: 'Upload per participant', calc: '1.5 + 0.5 + 0.15 = 2.15 Mbps' },
        { label: 'Download per participant', calc: '1.5 + 8 × 0.15 + 3 × 0.04 = 1.5 + 1.2 + 0.12 = 2.82 Mbps' },
        { label: 'Per meeting', calc: 'ingress 10 × 2.15 = 21.5 Mbps; egress 10 × 2.82 = 28.2 Mbps' },
        { label: 'Fleet egress', calc: '100K × 28.2 Mbps = 2.82 Tbps' },
        { label: 'SFU count', calc: '2.82 Tbps ÷ 6 Gbps ≈ 470 boxes (+ N+1 per AZ, regional spread)' },
        { label: 'Mesh comparison', calc: 'each client would upload 9 × 1.5 = 13.5 Mbps → impossible on mobile' },
      ],
      answer: '≈ 2.8 Tbps of SFU egress → about 470 SFU servers before redundancy and regional spread.',
      insight:
        'SFUs are egress-bound, not CPU-bound: scale and place them on network capacity, and use layer selection and Last-N to cut per-subscriber download. That cuts the fleet size more than any CPU optimisation.',
      followUps: [
        {
          q: 'Peak is 3× (Monday 10:00 IST across all tenants). What breaks first?',
          a: '3× gives 470 × 3 = 1,410 boxes at the same per-meeting profile. Regional skew hits first: India and Southeast Asia peak together, so the Mumbai/Singapore SFU pools saturate long before the global total does, and cross-region placement adds 60–100 ms. Plan per-region capacity from per-region peaks. Under pressure, downshift thumbnails (0.15 → 0.08 Mbps) and the HD speaker to 720p→480p before rejecting joins.',
        },
      ],
    },
    {
      id: 'design-modern-boe-3',
      question:
        'How many 8×H100 nodes does a ChatGPT-style service need at 20K prompts/s for a 70B-class model, and what limits each node?',
      assumptions: [
        'Average output 300 tokens at 50 tokens/s per stream; average context 4K tokens',
        'Model: 80 layers, 8 KV heads (GQA), head dim 128, fp16 weights and KV (~140 GB weights)',
        'Node: 8 × 80 GB HBM = 640 GB; ~60 GB for activations/runtime overhead',
      ],
      steps: [
        { label: 'Concurrent streams (Little’s law)', calc: '20K/s × (300 ÷ 50 = 6 s) = 120K streams' },
        { label: 'Output tokens/s', calc: '20K × 300 = 6M tokens/s' },
        { label: 'KV per token', calc: '2 × 80 × 8 × 128 × 2 B = 327,680 B = 320 KiB' },
        { label: 'KV per sequence', calc: '320 KiB × 4,096 = 1.25 GiB' },
        { label: 'Sequences per node', calc: '(640 − 140 − 60) = 440 GB ÷ 1.25 ≈ 352' },
        { label: 'Nodes', calc: '120K ÷ 352 ≈ 341 → ~343 nodes ≈ 2,744 GPUs; throughput check: 352 × 50 = 17.6K tok/s per node' },
        { label: 'Prefill load', calc: '20K/s × ~3K prompt tokens = 60M prefill tokens/s if nothing is cached' },
      ],
      answer: 'Roughly 340–350 nodes (~2,750 H100s), limited by KV-cache memory rather than compute.',
      insight:
        'KV memory sets concurrency, so PagedAttention, fp8 KV, shorter contexts and realistic max_tokens directly shrink the fleet. The 60M/s re-prefill of conversation history is why prefix caching and prefix-affinity routing are worth building.',
      followUps: [
        {
          q: 'You quantise the KV cache to fp8. How many nodes now, and what new limit appears?',
          a: 'KV per sequence halves to ~0.625 GiB, so ~704 sequences fit per node → 120K ÷ 704 ≈ 171 nodes by memory. But each node now has to produce 704 × 50 ≈ 35K tokens/s, and bigger batches make each decode step slower. If step time pushes inter-token latency past the SLO, you are compute/bandwidth-bound and need more nodes than 171. The real answer comes from benchmarking the batch-size vs ITL curve.',
        },
        {
          q: 'Average context doubles to 8K as users paste documents. What happens?',
          a: 'KV per sequence doubles to 2.5 GiB → ~176 sequences per node → ~682 nodes at the same concurrency, and prefill cost doubles too. Mitigate with per-tier context caps, summarising older turns, retrieval instead of pasting full documents, and prefix caching for repeated documents.',
        },
      ],
    },
    {
      id: 'design-modern-boe-4',
      question:
        'Estimate the write path for a Google-Docs-like product: collaboration servers needed and op-log volume per day.',
      assumptions: [
        '1M users actively typing at peak; clients batch keystrokes every 200 ms → ≤ 5 op messages/s each',
        'One collaboration server handles ~50K op messages/s (transform + append + broadcast)',
        '~100 bytes per stored op; daily average ≈ 30% of peak rate',
      ],
      steps: [
        { label: 'Peak op messages', calc: '1M × 5 = 5M msgs/s' },
        { label: 'Collab servers', calc: '5M ÷ 50K = 100 servers (+ headroom for hot docs)' },
        { label: 'Peak op-log write rate', calc: '5M × 100 B = 500 MB/s' },
        { label: 'Daily volume', calc: '500 MB/s × 86,400 s × 0.3 ≈ 13 TB/day' },
      ],
      answer: '~100 collaboration servers at peak and ~13 TB/day of raw op log.',
      insight:
        'The raw op log is too big to keep forever per keystroke. Compact it into snapshots and coarse history ("edits by X, 10:02–10:15"), and keep fine-grained ops only for a recent window. Client-side batching is the main lever on server count.',
      followUps: [
        {
          q: 'A new client build sends every keystroke immediately instead of batching (users type ~8 chars/s). What changes?',
          a: 'Messages per active user go from 5/s to 8/s → 1M × 8 = 8M msgs/s → 160 servers instead of 100, plus more broadcast frames and more op-log rows. Remote echo latency barely improves (200 ms batching is below perception for remote edits). Keep batching on the client and also coalesce on the server before append.',
        },
      ],
    },
  ],
  test: [
    // ---- live streaming ----
    {
      id: 'design-modern-mcq-1',
      difficulty: 'medium',
      question:
        'Your live HLS setup has 6 s segments, players start 3 segments behind the live edge, encoding + packaging takes ~2 s and CDN delivery ~0.5 s. Product wants glass-to-glass latency under 5 s for a fantasy-points overlay. Which change gets you there?',
      options: [
        'Shorten segments to 2 s and leave everything else unchanged',
        'Move to LL-HLS with ~0.5 s partial segments, blocking playlist reload and preload hints, with the player holding ~3 parts',
        'Pre-push segments to every edge so CDN delivery drops to near zero',
        'Switch first-mile contribution from RTMP to SRT',
      ],
      correct: [1],
      explanation:
        'Latency is dominated by the player buffer: 3 × 6 s = 18 s, plus ~2.5 s, gives ~20 s. LL-HLS publishes sub-second parts the player can fetch as soon as they exist, so the buffer shrinks to ~1.5 s and total latency lands near 4 s. 2 s segments still leave 3 × 2 + 2.5 ≈ 8.5 s and triple the request rate. Pre-pushing saves well under a second. SRT improves first-mile reliability, not the player buffer.',
      followUps: [
        {
          q: 'Your CDN does not support blocking playlist requests. What breaks with LL-HLS?',
          a: 'Players poll the playlist repeatedly to find the next part. Without the server holding the request until the part exists, they either poll every ~200 ms (huge request load and cache churn) or fall behind. You need a CDN/origin that supports `_HLS_msn`/`_HLS_part` blocking reloads, or you settle for short-segment HLS at ~8 s.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-2',
      difficulty: 'hard',
      question:
        'After a config refactor, viewers report that the "LIVE" stream is up to a minute behind TV and some players stall at the live edge. Origin load dropped sharply. What is the cause?',
      code: {
        language: 'typescript',
        code: `app.get('/live/:stream/:file', async (req, res) => {
  const obj = await originStore.get(req.params.stream, req.params.file);
  // one policy for everything: fewer origin hits, cheaper CDN bill
  res.set('Cache-Control', 'public, max-age=60');
  res.type(req.params.file.endsWith('.m3u8')
    ? 'application/vnd.apple.mpegurl' : 'video/mp4');
  res.send(obj);
});`,
      },
      options: [
        'Segments cached for 60 s are being served corrupted by the CDN',
        'The wrong MIME type for .m4s causes players to fall back to a lower rendition',
        'max-age=60 forces players to re-download every segment every minute, saturating client bandwidth',
        'The media playlist is cached for 60 s, so the edge keeps serving an old window; players lag behind and stall when they reach the end of the stale list',
      ],
      correct: [3],
      explanation:
        'Segments are immutable, so a long TTL is correct for them. The playlist changes every segment. Caching it for 60 s means the edge serves a list that is up to 15 segments old: players start far behind and, after playing the last listed segment, wait for a refresh that the cache will not give. Corruption and re-download are not caused by TTL. The MIME type is fine for fMP4 segments.',
      followUps: [
        {
          q: 'With the playlist at max-age=1, how do you stop 30M players from hammering the origin with playlist refreshes?',
          a: 'Request collapsing at the edge and shield: during each 1 s TTL, only one request per edge node (and then per shield) goes upstream, and the rest are served from cache or wait on the in-flight fetch. Origin playlist load becomes ≈ shields × renditions per second, independent of viewer count. `stale-while-revalidate` smooths the refresh boundary.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-3',
      difficulty: 'hard',
      question:
        'An IPL match starts in 20 minutes. History says concurrency will jump from 5M to 25M within 3 minutes of the toss. Select ALL actions that actually help.',
      options: [
        'Pre-scale playback, login and entitlement services to the forecast concurrency ladder before the toss',
        'Rely on CPU-based autoscaling with a 5-minute cooldown; it will catch up',
        'Have panic-mode flags ready that disable recommendations and personalised rails',
        'Lower the start bitrate and cap the top rendition for new sessions if CDN headroom is thin',
        'Reduce segment duration to 1 s so each CDN request is smaller',
      ],
      correct: [0, 2, 3],
      explanation:
        'Pre-scaling on a concurrency forecast beats the reaction time problem (1M+ joins per minute vs minutes to boot). Panic mode removes non-critical load from the API tier. Bitrate caps reduce egress quickly. CPU autoscaling with a cooldown reacts after users have already timed out. 1 s segments quadruple the request rate and do not lower egress.',
      followUps: [
        {
          q: 'The forecast was wrong and concurrency is 40% above the ladder. What is the order of levers?',
          a: 'First shed non-critical API work (panic mode) and lengthen token/entitlement caching so existing viewers stop generating calls. Then shift new sessions across CDNs and cap renditions. Only then put new joins through a virtual waiting room. Existing viewers are protected at every step, because a rejected join is far cheaper than a mass rebuffer.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-4',
      difficulty: 'expert',
      question:
        'Every 4 seconds, a fraction of viewers in one city stall for ~10 s. Logs show some edge servers requested the next segment a few hundred milliseconds before the packager finished writing it, got 404 from the origin, and the CDN default caches 404s for 10 s. What is the right fix?',
      options: [
        'Only list a segment in the playlist after it is fully written, and set a 0–1 s negative-cache TTL (or have the origin hold the request) for not-yet-available segments',
        'Add more origin capacity so the packager writes faster',
        'Increase the player buffer to 3 segments so the 10 s stall is absorbed',
        'Disable request collapsing so each edge server retries independently',
      ],
      correct: [0],
      explanation:
        'Players request what the playlist advertises. If a segment is listed before it exists, or an edge prefetches speculatively, a 404 is returned and cached for 10 s at that PoP, freezing everyone behind it. Advertise only complete segments and keep negative caching near zero (LL-HLS blocking requests do this properly). Origin capacity is not the issue. A bigger buffer hides it at the cost of latency. Disabling collapsing multiplies origin load.',
      followUps: [
        {
          q: 'Why can request collapsing make this failure worse rather than better?',
          a: 'Collapsing shares one upstream response with every waiting request. If that response is a 404 and it gets cached, the error spreads to every viewer behind that edge or shield for the full negative TTL. Collapsing must be paired with short or zero error caching for live paths.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-5',
      difficulty: 'hard',
      question:
        'This reaction service backs a stream with 10M viewers spread over 2,000 SSE gateways. Each gateway subscribes to the stream channel. During a big moment, 200K reactions/s arrive. What happens?',
      code: {
        language: 'typescript',
        code: `export async function onReaction(streamId: string, userId: string, emoji: string) {
  await redis.publish('stream:' + streamId,
    JSON.stringify({ type: 'reaction', userId, emoji, ts: Date.now() }));
}

// each gateway
sub.subscribe('stream:' + streamId);
sub.on('message', (_ch, msg) => {
  for (const client of clientsOf(streamId)) client.write('data: ' + msg + '\\n\\n');
});`,
      },
      options: [
        'Fine: Redis pub/sub handles millions of messages per second',
        'Redis must deliver 200K × 2,000 = 400M messages/s and gateways must write 200K events/s to every client; it collapses. Aggregate counts per second before publishing',
        'Only the gateways suffer; Redis just forwards one copy per message',
        'The problem is SSE; switching gateways to WebSocket fixes the throughput',
      ],
      correct: [1],
      explanation:
        'Pub/sub delivers each published message to every subscriber, so 200K/s × 2,000 gateways = 400M deliveries/s, far beyond one Redis. Each client would also receive 200K events/s. Per-second aggregation (one count map per stream per second) reduces this to ~1 message/s per gateway. Transport choice does not change the fan-out math.',
      followUps: [
        {
          q: 'Aggregation runs on 50 ingestion shards. How do gateways show one consistent number?',
          a: 'Each shard publishes its partial count map with a window timestamp. Gateways (or a small merge tier) sum partials for the same window, waiting a short grace period (~200 ms) for stragglers, and then emit one merged event. Clients only need approximate counts, so a late shard\'s numbers roll into the next window instead of blocking.',
        },
      ],
    },
    // ---- video conferencing ----
    {
      id: 'design-modern-mcq-6',
      difficulty: 'medium',
      question:
        'Your SFU-based meeting product must let a legacy hardware room system (can decode only one video stream) and PSTN dial-in callers join the same meetings. What is the most reasonable design?',
      options: [
        'Switch the whole product to an MCU so every participant gets one composited stream',
        'Force the room system to use simulcast so it can choose one layer',
        'Keep the SFU for regular clients and add gateway components that subscribe to the SFU and mix/composite only for the legacy room system and the PSTN audio legs',
        'Use mesh P2P for the legacy device so it connects to each participant directly',
      ],
      correct: [2],
      explanation:
        'Mixing is needed only for endpoints that cannot handle multiple streams, so a hybrid confines MCU-style decode/encode cost to those legs. Converting everyone to an MCU adds latency and huge CPU cost for clients that do not need it. Simulcast concerns what a publisher sends, not how many streams a receiver can decode. Mesh would make the legacy device decode even more streams.',
      followUps: [
        {
          q: 'The PSTN gateway mixes audio. Which participants\' audio should it include?',
          a: 'The top ~3 active speakers by audio level, the same Last-N logic the SFU uses for clients. Mixing all 50 participants adds noise and CPU cost. The phone caller\'s own audio must be excluded from the mix sent back to them (mix-minus), or they hear themselves with a delay.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-7',
      difficulty: 'expert',
      question:
        'Subscribers see green/garbled video for a second whenever the SFU switches them from the 360p to the 720p simulcast layer. What is the bug in this forwarding code?',
      code: {
        language: 'typescript',
        code: `function onRtp(pkt: RtpPacket, sub: Subscriber) {
  if (pkt.layer !== sub.targetLayer) return;     // drop other layers
  sub.currentLayer = sub.targetLayer;            // switch immediately
  pkt.ssrc = sub.outSsrc;                        // single SSRC to the subscriber
  sub.send(pkt);                                 // seq/timestamp passed through
}`,
      },
      options: [
        'It should forward both layers during the transition so the decoder can choose',
        'It switches mid-GOP: it must wait for a keyframe on the target layer (requesting one via PLI) and rewrite sequence numbers and timestamps so the output stream stays continuous',
        'The SSRC should differ per layer so the subscriber can tell layers apart',
        'It should transcode the 720p packets down to 360p until the next keyframe',
      ],
      correct: [1],
      explanation:
        'Delta frames from the new layer reference frames the decoder never received, so they decode as garbage until a keyframe arrives. Each simulcast layer also has its own sequence/timestamp space, so passing them through creates jumps the receiver treats as loss. A correct SFU keeps forwarding the old layer, sends a rate-limited PLI, switches on the keyframe and rewrites seq/ts. Forwarding both layers wastes bandwidth and the decoder cannot use them. Per-layer SSRCs to the subscriber would require renegotiation. Transcoding defeats the purpose of an SFU.',
      followUps: [
        {
          q: 'With SVC (VP9/AV1) instead of simulcast, does the keyframe requirement go away?',
          a: 'Partly. Dropping temporal layers or moving down spatial layers can happen at many frame boundaries without a keyframe, because lower layers are self-contained in the SVC structure. Moving up a spatial layer still needs a switch point (a keyframe or a layer-switch-up frame). That is one reason SVC adapts more smoothly on fluctuating links.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-8',
      difficulty: 'hard',
      question:
        'Users in a bank\'s office network can open the meeting page and see the participant list, but never get audio or video. The network blocks all outbound UDP and allows only TCP 443 through a TLS-inspecting proxy. Select ALL changes that would let media flow.',
      options: [
        'Offer TURN over TLS on port 443 in the ICE servers list',
        'Add more STUN servers in different regions',
        'Have the SFU accept ICE-TCP candidates on port 443',
        'Increase the jitter buffer on the client',
        'Move signaling from WebSocket to long polling',
      ],
      correct: [0, 2],
      explanation:
        'Media needs a TCP/TLS path on 443: either a TURN relay over TLS or the SFU accepting ICE-TCP directly. Both look like ordinary outbound 443 traffic. STUN only discovers addresses and cannot relay, so more STUN servers change nothing. The jitter buffer does not help when no packets arrive. Signaling already works, as the participant list shows.',
      followUps: [
        {
          q: 'Quality over TURN/TLS is noticeably worse even when bandwidth is fine. Why?',
          a: 'TCP retransmits lost packets in order, so one loss stalls every packet behind it (head-of-line blocking). Real-time media would rather skip late packets, so jitter grows, the jitter buffer expands, and latency and freezes increase. The TLS-inspecting proxy adds its own buffering. TCP paths should be the fallback, with UDP preferred whenever ICE finds one.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-9',
      difficulty: 'hard',
      question:
        'A 300-person town hall on your SFU: CPU on the SFU is fine but its egress NIC saturates and attendees\' downloads spike. Every client currently subscribes to every camera at the thumbnail layer. Which change fixes the root cause with the least product impact?',
      options: [
        'Move the meeting to a bigger SFU with a 40 GbE NIC',
        'Turn off simulcast so each publisher sends a single 720p stream',
        'Lower every thumbnail to 90p',
        'Forward video only for the last N active speakers (e.g. 9) plus the pinned presenter, and send others as audio only with avatars',
      ],
      correct: [3],
      explanation:
        'Egress scales with subscribers × forwarded streams: 300 × 299 thumbnails is ~90K streams. Last-N caps forwarded video per subscriber at a small constant, so egress grows linearly with attendees. A bigger NIC postpones the problem. 90p thumbnails reduce bitrate but keep the quadratic stream count. Disabling simulcast removes the SFU\'s ability to adapt per subscriber and makes egress worse.',
      followUps: [
        {
          q: 'How does the SFU know who the active speakers are without decoding audio?',
          a: 'Clients add the audio-level RTP header extension (RFC 6464) to their audio packets, giving the speech level in dB. The SFU reads this unencrypted header and keeps a smoothed per-participant score, with hysteresis so a cough does not trigger a speaker switch. The top N scores decide which video tracks to forward.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-10',
      difficulty: 'expert',
      question:
        'You enable end-to-end encryption (insertable streams + SFrame, keys never on servers) for meetings. Select ALL features that stop working or must move to clients.',
      options: [
        'Server-side cloud recording with composited layout',
        'Live server-side captions / AI meeting summary',
        'SFU simulcast layer selection per subscriber',
        'PSTN dial-in through a server-side audio mixer',
        'Active-speaker detection from the audio-level RTP header extension',
      ],
      correct: [0, 1, 3],
      explanation:
        'Anything that needs the decoded media on a server breaks: recording/compositing, server-side speech recognition, and a PSTN mixer that must decode and re-encode audio. Simulcast selection and active-speaker detection use RTP headers and header extensions, which stay readable, so the SFU keeps working. That is the point of encrypting only the frame payload.',
      followUps: [
        {
          q: 'How are keys rotated when someone leaves an E2EE meeting?',
          a: 'Clients derive a new media key and distribute it over the E2EE key-exchange channel (e.g. MLS or pairwise encrypted signaling) to the remaining participants only. Senders switch to the new key id, and receivers keep the old key for a short overlap to decrypt in-flight frames. The departed participant cannot read media after the switch. The server only relays encrypted key messages.',
        },
      ],
    },
    // ---- LLM service ----
    {
      id: 'design-modern-mcq-11',
      difficulty: 'expert',
      question:
        'An 8B-class model with this config runs on a GPU with 40 GB free for KV cache after loading weights (fp16 KV). Roughly how many 8K-token sequences can run concurrently?',
      code: {
        language: 'json',
        code: `{
  "num_hidden_layers": 32,
  "num_attention_heads": 32,
  "num_key_value_heads": 8,
  "head_dim": 128,
  "torch_dtype": "float16"
}`,
      },
      options: ['About 10', 'About 40', 'About 80', 'About 160'],
      correct: [1],
      explanation:
        'KV per token = 2 (K and V) × 32 layers × 8 KV heads × 128 × 2 bytes = 131,072 B = 128 KiB. 40 GiB ÷ 128 KiB = 327,680 tokens ÷ 8,192 ≈ 40 sequences. Using all 32 attention heads instead of the 8 KV heads (ignoring GQA) gives ~10. Forgetting the factor of 2 for K and V gives ~80. Both mistakes are common in interviews.',
      followUps: [
        {
          q: 'The product manager wants 32K context for everyone on this GPU. What happens to concurrency, and what would you offer instead?',
          a: 'At 32K each sequence needs 4 GiB, so only ~10 fit and throughput collapses. But only sequences that actually use long context need that memory: with paged KV, a 32K limit costs nothing for short chats. Offer 32K as a cap rather than a reservation, route long-context requests to a dedicated pool, and consider fp8 KV (2× capacity) for that pool.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-12',
      difficulty: 'medium',
      question:
        'Your inference server forms batches of 32 requests and runs each batch until every sequence finishes. Short answers (50 tokens) take as long as long ones (2,000 tokens), and new requests wait for the current batch. What change gives the biggest improvement?',
      options: [
        'Iteration-level (continuous) batching: finished sequences leave and waiting ones join at every decode step',
        'Increase the batch size to 128',
        'Sort requests by prompt length before batching',
        'Add a second replica and round-robin between them',
      ],
      correct: [0],
      explanation:
        'Static batching ties every request to the slowest member of its batch and blocks admission until the batch drains. Continuous batching schedules per step, so short answers return as soon as they finish and new requests start without waiting. Bigger batches make the head-of-line effect worse. Sorting by prompt length does not predict output length. Another replica halves the queue but keeps the waste.',
      followUps: [
        {
          q: 'With continuous batching, new requests join every step. Why can that hurt users who are already streaming?',
          a: 'A joining request first needs prefill of its whole prompt. A long prompt (say 20K tokens) inserted into a step makes that step much slower, so every in-flight stream pauses visibly. Chunked prefill limits the prompt tokens processed per step so decode latency stays bounded.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-13',
      difficulty: 'expert',
      question:
        'Multi-turn chats with long histories have poor time-to-first-token, because each turn re-sends the whole conversation. Select ALL changes that directly reduce TTFT for these chats.',
      options: [
        'Enable prefix caching and route each conversation to the replica likely to hold its prefix (consistent hashing with bounded load)',
        'Summarise older turns in stable chunks so the prompt shrinks and the prefix stays identical between turns',
        'Increase the maximum decode batch size so more sequences run per step',
        'Run prefill on a dedicated prefill pool so it is not queued behind decode-heavy batches',
        'Switch the client transport from SSE to WebSocket',
      ],
      correct: [0, 1, 3],
      explanation:
        'Prefix caching with affinity routing skips recomputing KV for history already processed. Stable chunked summaries shrink the prompt without invalidating the cached prefix every turn. A dedicated prefill pool removes queueing behind decode. Larger decode batches raise throughput but tend to lengthen steps and queueing, not TTFT. The transport adds only milliseconds; TTFT is spent on the GPU.',
      followUps: [
        {
          q: 'Prefix-affinity routing sends a very hot system prompt to one replica. How do you avoid a hotspot?',
          a: 'Hash on the conversation-specific prefix (system prompt + conversation id), not the shared system prompt alone. Every replica can cache the shared system prompt independently, since it is cheap to hold. Use consistent hashing with bounded load so an overloaded replica spills to the next one on the ring, accepting a cache miss instead of a long queue.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-14',
      difficulty: 'hard',
      question:
        'A power user fires 50 parallel requests, each with max_tokens = 4,000, and all of them run even though the limit is 60K tokens per minute. Why?',
      code: {
        language: 'typescript',
        code: `async function handle(req: ChatRequest, user: User) {
  const used = Number(await redis.get('tpm:' + user.id + ':' + minute())) || 0;
  if (used > 60_000) throw new TooManyRequests();
  const out = await engine.generate(req.prompt, { maxTokens: req.maxTokens });
  await redis.incrby('tpm:' + user.id + ':' + minute(), out.promptTokens + out.outputTokens);
  return out;
}`,
      },
      options: [
        'The INCRBY should be INCR so each request counts as one',
        'Redis GET is eventually consistent, so the read is stale',
        'The minute() bucket resets too often; use a 24-hour key instead',
        'Usage is charged only after generation finishes, so all 50 requests pass the check while the counter is still ~0. Reserve prompt + max_tokens atomically before generating and refund the remainder',
      ],
      correct: [3],
      explanation:
        'Check-then-act with post-hoc accounting has a window equal to the whole generation time: every concurrent request sees the old counter. Atomically reserving the worst-case cost (prompt + max_tokens) at admission closes the window, and refunding unused tokens keeps it fair. Counting requests instead of tokens defeats token limits. A 24-hour key changes the window, not the race. A single Redis primary is not eventually consistent for GET.',
      followUps: [
        {
          q: 'Even with reservations, a user can hold 50 slow streams open. What second limit do you add?',
          a: 'A concurrent-stream limit per user/key: `INCR inflight` at admission with a TTL refreshed by a heartbeat, and `DECR` in `finally`. Each open stream holds KV memory on a GPU for its whole duration, so concurrency is a separate resource from tokens per minute. Return 429 with a clear error code when it is exceeded.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-15',
      difficulty: 'expert',
      question:
        'Requirements: (1) if a user reloads the page mid-answer, they see the answer continue; (2) pressing Stop frees the GPU immediately; (3) API-tier deploys must not kill in-flight answers. Which design satisfies all three?',
      options: [
        'Cancel generation when the HTTP connection closes; on reload, re-run the prompt from scratch',
        'Sticky sessions on the load balancer so the reloaded page reaches the same API pod',
        'Run generation independently of the request: tokens go to a per-message buffer (e.g. Redis Stream) and are persisted; SSE handlers only read from it by event id; Stop calls a cancel API that aborts the engine job',
        'Use WebSockets instead of SSE so the connection survives reloads',
      ],
      correct: [2],
      explanation:
        'Decoupling generation from the client connection makes reloads and deploys just a reader reconnecting with Last-Event-ID, while an explicit cancel path frees KV blocks on Stop. Cancel-on-close plus re-running doubles cost and produces a different answer. Sticky sessions do not survive a pod restart during a deploy. A WebSocket dies on reload like any other connection.',
      followUps: [
        {
          q: 'Nobody reconnects and nobody presses Stop: the tab was closed. Should generation continue?',
          a: 'It is a cost vs UX policy. Many products let short answers finish so the history is complete, but cancel when no reader has attached for ~30–60 s and the remaining `max_tokens` is large. Track reader count per message stream and have a reaper send cancels. The partial answer is saved with status `stopped`, and the user can continue later.',
        },
      ],
    },
    // ---- collaborative editing ----
    {
      id: 'design-modern-mcq-16',
      difficulty: 'hard',
      question:
        'The document is "abc" at rev 5. Client A sends ins(1, \'X\') and client B sends del(2), both with baseRev 5. The server applies A first as rev 6. What does the server document become if it applies B\'s op untransformed, and what should it be?',
      code: {
        language: 'typescript',
        code: `type Op = { type: 'ins'; pos: number; ch: string } | { type: 'del'; pos: number };
// apply(text, op): ins inserts ch at pos; del removes the char at pos
let doc = 'abc';
doc = apply(doc, { type: 'ins', pos: 1, ch: 'X' });  // rev 6
doc = apply(doc, { type: 'del', pos: 2 });           // B's op, rev 7 (untransformed)`,
      },
      options: [
        'Untransformed: "aXc"; correct: "aXb"',
        'Untransformed: "aXb"; correct: "aXb" (no transform needed)',
        'Untransformed: "abc"; correct: "aXbc"',
        'Untransformed: "aXc"; correct: "aXc"',
      ],
      correct: [0],
      explanation:
        'After A, the text is "aXbc". B meant to delete \'c\' (index 2 in "abc"), but index 2 in "aXbc" is \'b\', giving "aXc", so B\'s intent is violated. Transforming B against A shifts the delete to index 3 because A inserted before it, which removes \'c\' and yields "aXb" on every replica.',
      followUps: [
        {
          q: 'Client A also has B\'s op to apply locally. What does A transform, and against what?',
          a: 'A has already applied its own ins(1,\'X\') optimistically. When the server broadcasts B\'s op as rev 7, it is already transformed against A (del(3)) because the server sequenced A first, so A applies it directly. If A had another unacknowledged op in flight, A would transform the incoming op against that pending op, and the pending op against the incoming one, before applying.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-17',
      difficulty: 'expert',
      question:
        'Two clients concurrently insert at the same position. Each client transforms the other\'s op with this function before applying it. What happens?',
      code: {
        language: 'typescript',
        code: `// a: incoming remote op, b: my already-applied local op (both inserts)
function transformInsIns(a: Ins, b: Ins): Ins {
  return b.pos <= a.pos ? { ...a, pos: a.pos + 1 } : a;
}
// doc "hello" ; A inserts '1' at 5 ; B inserts '2' at 5`,
      },
      options: [
        'Both converge to "hello12" because positions are shifted consistently',
        'Both converge to "hello21"',
        'They diverge: A ends with "hello12" and B with "hello21", because each side treats its own insert as winning the tie',
        'An exception is thrown because positions collide',
      ],
      correct: [2],
      explanation:
        'At A: local "hello1", then B\'s insert at 5 is shifted to 6 → "hello12". At B: local "hello2", then A\'s insert shifts to 6 → "hello21". With equal positions each side puts its own character first, so the replicas disagree. The tie must be broken by a global rule, such as comparing client ids or letting the server-sequenced op win, applied identically everywhere.',
      followUps: [
        {
          q: 'With a central sequencer, why do you still need a tie-break rule at all?',
          a: 'The server decides the order of commits, but clients transform optimistically before they know that order: each client transforms incoming server ops against its own pending ops. Client and server must make the same decision for equal positions, otherwise the client\'s local view differs from what the server committed. A shared rule such as "lower client id goes first" makes both sides compute the same result.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-18',
      difficulty: 'hard',
      question: 'Comparing server-sequenced OT with CRDTs for a collaborative editor, select ALL statements that are true.',
      options: [
        'CRDTs can merge edits from replicas that were offline for days without a central server deciding the order',
        'CRDT documents carry per-character identifiers and tombstones, so memory and payload grow with edit history unless garbage-collected',
        'With a single server sequencing ops per document, OT needs only transformation property TP1, not TP2',
        'CRDT-based editors can never interleave characters of two users typing concurrently at the same position',
        'OT requires a vector clock attached to every character in the document',
      ],
      correct: [0, 1, 2],
      explanation:
        'CRDT merges commute, so offline replicas converge without an ordering authority. The cost is ids and tombstones that need GC. A central sequencer gives a total order, so OT needs only TP1. Some sequence CRDTs (e.g. RGA, Logoot) can interleave concurrent runs, which is why newer algorithms like Fugue exist. OT works on positions plus revisions, not per-character vector clocks.',
      followUps: [
        {
          q: 'Why is garbage-collecting CRDT tombstones hard?',
          a: 'A tombstone can be removed only when every replica that might still reference it (as an insertion anchor) has seen the deletion. With unbounded offline clients you never know that for sure. Systems either keep tombstones, compact them in encoded form (Yjs merges deleted runs), or require clients offline beyond a cutoff to resync from a snapshot, which gives up pure offline merging for them.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-19',
      difficulty: 'expert',
      question:
        'Collaboration server S1 owns doc 42 via a lease. S1 suffers a 30 s GC pause; the lease expires and S2 takes over, loads the snapshot and commits revs 9001–9010. S1 wakes up with an op it had already transformed as rev 9001. What prevents a forked history?',
      options: [
        'The Redis lease: S1 checks it before every write, so it will notice it lost ownership',
        'Clients compare document hashes and fix any divergence',
        'An append-only op log with PRIMARY KEY (doc_id, rev): S1\'s insert of rev 9001 conflicts, it gets 0 rows, drops the doc and tells its clients to reconnect',
        'S2 replays S1\'s in-memory buffer after taking over',
      ],
      correct: [2],
      explanation:
        'A lease check followed by a write is not atomic: S1 can pass the check just before or after the pause and still write. The storage-level uniqueness on (doc_id, rev) acts as a fencing token, so exactly one writer can commit each revision. Client hash checks detect divergence after the damage. S2 cannot see S1\'s memory.',
      followUps: [
        {
          q: 'The op log is in Cassandra, where inserts are upserts. How do you keep the fence?',
          a: 'Use a lightweight transaction: `INSERT ... IF NOT EXISTS` (Paxos-backed compare-and-set) on `(doc_id, rev)`. This costs a few extra round trips per op, which is acceptable at ~hundreds of ops/s per doc. Alternatively, put the fence on an epoch: each owner writes with its lease epoch and the storage rejects writes from a lower epoch, using conditional updates on a per-doc metadata row.',
        },
      ],
    },
    {
      id: 'design-modern-mcq-20',
      difficulty: 'medium',
      question:
        'A team sends every cursor movement (~30 per second per user) as an op through the same pipeline as text edits: sequenced, written to the op log and broadcast. Docs with 50 viewers now lag. What is the right fix?',
      options: [
        'Treat presence as ephemeral: send it on the socket outside the op log, throttle to ~5–10 updates/s, keep only the latest value per user, never persist it, and expire it on heartbeat loss',
        'Shard the op log so cursor ops go to a different table',
        'Batch cursor ops every 5 seconds and persist them in bulk',
        'Remove cursors for documents with more than 10 users',
      ],
      correct: [0],
      explanation:
        'Cursor positions are last-value-wins state with no history value, so sequencing and persisting them wastes the sequencer, the log and the bandwidth. Throttled ephemeral presence keeps the experience while cutting load by an order of magnitude or more. A separate table still persists useless data. 5 s batching makes cursors feel broken. Dropping cursors entirely is a product regression that is not needed.',
      followUps: [
        {
          q: 'Cursors are now ephemeral. Why can a remote cursor still appear in the wrong place after edits?',
          a: 'A cursor is an index into the text. If someone inserts text before it, the index points to a different character until the next presence update arrives. Clients must transform remote cursor positions against every op they apply, as with any other position. With a CRDT, anchor the cursor to a character id instead, and it never drifts.',
        },
      ],
    },
  ],
};

export default topic;
