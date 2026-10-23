// Pure bandwidth/CPU model of a group video call (no React, Node-testable). Numbers follow the
// topic's estimation: HD video 1.5 Mbps, simulcast layers 1.5 + 0.5 + 0.15 Mbps, audio 40 kbps.
//   mesh : every client sends its stream to every other client and receives N−1 streams.
//   MCU  : clients send one stream; the server decodes all N, composites, re-encodes N mixes
//          (each without the viewer's own video) and sends one stream back. +~150 ms encode delay.
//   SFU  : clients send one stream (or 3 simulcast layers); the server forwards packets without
//          decoding. With simulcast each viewer gets the active speaker in HD, everyone else as a
//          150 kbps thumbnail, and at most 3 audio streams; without it, N−1 full HD streams.
import type { BaseFrame } from '../../core';

export type Topology = 'mesh' | 'mcu' | 'sfu';

export interface Params {
  topology: Topology;
  max: number;
  simulcast: boolean;
}

export const DEFAULT_PARAMS: Params = { topology: 'sfu', max: 10, simulcast: true };

export const HD = 1.5;
export const MID = 0.5;
export const THUMB = 0.15;
export const AUDIO = 0.04;
export const HOME_UPLINK = 10;
export const HOME_DOWNLINK = 50;

export interface Metrics {
  n: number;
  up: number;
  down: number;
  /** streams the server decodes + encodes per second-of-video */
  serverCodec: number;
  /** streams the server forwards */
  serverForward: number;
  latencyMs: number;
  /** distinct media streams on the wire */
  wireStreams: number;
}

export function metrics(topology: Topology, n: number, simulcast: boolean): Metrics {
  const others = n - 1;
  const r = (x: number) => Math.round(x * 100) / 100;
  if (n < 2) return { n, up: 0, down: 0, serverCodec: 0, serverForward: 0, latencyMs: 0, wireStreams: 0 };
  if (topology === 'mesh') {
    return { n, up: r(others * (HD + AUDIO)), down: r(others * (HD + AUDIO)), serverCodec: 0, serverForward: 0, latencyMs: 0, wireStreams: n * others };
  }
  if (topology === 'mcu') {
    return { n, up: r(HD + AUDIO), down: r(HD + AUDIO), serverCodec: 2 * n, serverForward: 0, latencyMs: 150, wireStreams: 2 * n };
  }
  const up = simulcast ? HD + MID + THUMB + AUDIO : HD + AUDIO;
  const audios = Math.min(3, others);
  const down = simulcast ? HD + Math.max(0, others - 1) * THUMB + audios * AUDIO : others * HD + audios * AUDIO;
  return { n, up: r(up), down: r(down), serverCodec: 0, serverForward: n * others, latencyMs: 3, wireStreams: n + n * others };
}

export interface Frame extends BaseFrame {
  m: Metrics;
  joined: number;
  history: Metrics[];
}

export function simulate({ topology, max, simulcast }: Params): Frame[] {
  const frames: Frame[] = [];
  const history: Metrics[] = [];
  const label = topology === 'mesh' ? 'Mesh (peer-to-peer)' : topology === 'mcu' ? 'MCU (mixing server)' : `SFU (forwarding server${simulcast ? ', simulcast' : ''})`;
  let warned = false;
  for (let n = 2; n <= max; n++) {
    const m = metrics(topology, n, simulcast);
    history.push(m);
    const notes: string[] = [];
    if (topology === 'mesh') {
      notes.push(`Each client now uploads ${n - 1} copies of its video (${m.up} Mbps) and decodes ${n - 1} streams.`);
      if (m.up > HOME_UPLINK) notes.push(`That exceeds a typical ${HOME_UPLINK} Mbps home uplink: video freezes for everyone.`);
    } else if (topology === 'mcu') {
      notes.push(`Each client sends and receives exactly one stream (${m.up} Mbps), but the server decodes ${n} streams and re-encodes ${n} personal mixes: ${m.serverCodec} codec jobs, plus ~150 ms of encode delay.`);
    } else {
      notes.push(
        simulcast
          ? `Each client uploads 3 simulcast layers (${m.up} Mbps). The SFU forwards, without decoding, the HD layer of the speaker and 150 kbps thumbnails of the rest: ${m.down} Mbps down.`
          : `Each client uploads one HD stream (${m.up} Mbps); without simulcast the SFU must forward every stream in HD, so downlink grows to ${m.down} Mbps.`,
      );
    }
    let predict: string | undefined;
    if (!warned && topology === 'mesh' && metrics('mesh', n + 1, simulcast).up > HOME_UPLINK && n + 1 <= max) {
      predict = `One more person joins. Can a ${HOME_UPLINK} Mbps home uplink keep up?`;
      warned = true;
    }
    frames.push({
      caption: n === 2 ? `${label}: two people are in the call. ${notes.join(' ')}` : `Participant ${n} joins. ${notes.join(' ')}`,
      predict,
      m,
      joined: n,
      history: [...history],
    });
  }
  const last = history[history.length - 1];
  frames.push({
    caption:
      topology === 'mesh'
        ? `Result with ${max} people: ${last.up} Mbps up per client (${max === 10 ? 'the topic\'s 13.5 Mbps video figure plus audio' : `${max - 1} copies`}). Mesh is great for 1:1 calls (lowest latency, no server) and unusable for groups.`
        : topology === 'mcu'
          ? `Result with ${max} people: cheap for clients, expensive for the server (${last.serverCodec} decode/encode jobs per call) and ~150 ms slower. Keep MCU-style mixing for edges such as PSTN dial-in or recording.`
          : `Result with ${max} people: ${last.up} Mbps up and ${last.down} Mbps down per client, ~3 ms of forwarding delay and no transcoding. SFU is the default for group calls${simulcast ? '' : '; turn simulcast on to cut the downlink'}.`,
    m: last,
    joined: max,
    history: [...history],
  });
  return frames;
}
