// Pure model of a live HLS/DASH player doing adaptive bitrate (no React, Node-testable).
//   Ladder: 1080p 5 Mbps, 720p 3 Mbps, 480p 1.2 Mbps, 360p 0.6 Mbps, GOP-aligned so the player can
//   switch at any segment boundary. The player stays LIVE_SEGS segments behind the live edge, so its
//   buffer can never exceed LIVE_SEGS × segment length (it cannot fetch segments not yet produced).
//   ABR (throughput rule + buffer guard): estimate = harmonic mean of the last 3 segment throughputs
//   (a conservative 2 Mbps before any sample); pick the highest rung ≤ 0.8 × estimate; if the
//   buffer holds less than one segment, step one rung lower still.
//   Download time = rung bitrate × segment seconds / bandwidth. If it exceeds the buffer, playback
//   stalls (rebuffers) for the difference.
import type { BaseFrame } from '../../core';

export type Profile = 'drop' | 'spiky' | 'stable';
export type Mode = 'abr' | 'fixed';

export interface Params {
  profile: Profile;
  seg: 2 | 4 | 6;
  mode: Mode;
}

export const DEFAULT_PARAMS: Params = { profile: 'drop', seg: 4, mode: 'abr' };

export const LADDER = [
  { name: '1080p', mbps: 5 },
  { name: '720p', mbps: 3 },
  { name: '480p', mbps: 1.2 },
  { name: '360p', mbps: 0.6 },
];
export const LIVE_SEGS = 3;
export const SAFETY = 0.8;
export const DURATION = 48;
export const INITIAL_ESTIMATE = 2;

export function bandwidth(profile: Profile, t: number): number {
  if (profile === 'stable') return 8;
  if (profile === 'drop') return t < 14 ? 8 : t < 30 ? 1.6 : 6;
  return Math.floor(t / 6) % 2 === 0 ? 7 : 2.2;
}

const DT = 0.05;

/** megabits received between t and t + dur under a time-varying bandwidth */
export function downloadedIn(profile: Profile, t: number, dur: number): number {
  let got = 0;
  for (let x = 0; x < dur - 1e-9; x += DT) got += bandwidth(profile, t + x) * Math.min(DT, dur - x);
  return got;
}

/** seconds to download `megabits` starting at t, integrating the bandwidth as it changes */
export function downloadTime(profile: Profile, megabits: number, t: number): number {
  let left = megabits;
  let dt = 0;
  while (left > 1e-9) {
    const b = bandwidth(profile, t + dt);
    const step = Math.min(DT, left / b);
    left -= b * step;
    dt += step;
  }
  return dt;
}

export function chooseRung(estimate: number, buffer: number, seg: number): number {
  let i = LADDER.findIndex((r) => r.mbps <= SAFETY * estimate);
  if (i === -1) i = LADDER.length - 1;
  if (buffer < seg && i < LADDER.length - 1) i++;
  return i;
}

export interface Sample {
  /** wall-clock time the segment finished downloading */
  t: number;
  start: number;
  bw: number;
  rung: number;
  buffer: number;
  stall: number;
  /** an aborted first attempt at a higher rung: which rung and how long it ran */
  abandoned: { rung: number; probe: number } | null;
  /** wall-clock time the segment's bytes finished arriving */
  dlEnd: number;
}

export interface Frame extends BaseFrame {
  seq: number;
  rung: number | null;
  estimate: number;
  bw: number;
  buffer: number;
  stallTotal: number;
  samples: Sample[];
  switched: boolean;
  latency: number;
}

export function simulate({ profile, seg, mode }: Params): Frame[] {
  const frames: Frame[] = [];
  const samples: Sample[] = [];
  const thr: number[] = [];
  let t = 0;
  let buffer = 0;
  let stallTotal = 0;
  let prev: number | null = null;
  const n = Math.floor(DURATION / seg);
  const latency = Math.round(2 + LIVE_SEGS * seg);
  const harmonic = () => {
    const last = thr.slice(-3);
    return last.length ? last.length / last.reduce((a, x) => a + 1 / x, 0) : INITIAL_ESTIMATE;
  };

  frames.push({
    caption: `The live transcoder decodes the stadium feed once and encodes ${LADDER.map((r) => `${r.name} (${r.mbps} Mbps)`).join(', ')} with keyframes aligned every ${seg} s. The packager cuts ${seg}-second CMAF segments and the CDN serves them. The player sits ${LIVE_SEGS} segments behind live: ~${latency} s glass-to-glass.`,
    seq: -1,
    rung: null,
    estimate: INITIAL_ESTIMATE,
    bw: bandwidth(profile, 0),
    buffer: 0,
    stallTotal: 0,
    samples: [],
    switched: false,
    latency,
  });

  for (let i = 0; i < n; i++) {
    const e = harmonic();
    let before = buffer;
    let rung = mode === 'fixed' ? 0 : chooseRung(e, i === 0 ? Infinity : before, seg);
    const guarded = mode === 'abr' && i > 0 && rung !== chooseRung(e, Infinity, seg);
    const start = t;
    const bw = bandwidth(profile, t);
    let d = downloadTime(profile, LADDER[rung].mbps * seg, t);
    let abandoned: Sample['abandoned'] = null;
    // a real player watches the download's progress; if it cannot finish before the buffer runs
    // out, it aborts early and re-requests the same segment from a lower rung
    if (mode === 'abr' && i > 0 && d > before && rung < LADDER.length - 1) {
      const probe = Math.min(1, before / 2);
      const measured = (downloadedIn(profile, t, probe) / probe) || bw;
      const next = chooseRung(measured, before - probe, seg);
      if (next > rung) {
        abandoned = { rung, probe };
        t += probe;
        before -= probe;
        rung = next;
        d = downloadTime(profile, LADDER[rung].mbps * seg, t);
      }
    }
    let stall = 0;
    if (i === 0) buffer = seg; // startup: playback begins once the first segment is in
    else if (d > before) {
      stall = d - before;
      buffer = seg;
    } else buffer = before - d + seg;
    t += d;
    stallTotal += stall;
    // live edge: cannot hold more than LIVE_SEGS segments; wait for the next one to be produced
    const cap = LIVE_SEGS * seg;
    if (buffer > cap) {
      t += buffer - cap;
      buffer = cap;
    }
    const sample = (LADDER[rung].mbps * seg) / d;
    thr.push(sample);
    samples.push({ t, start, bw, rung, buffer, stall, abandoned, dlEnd: start + (abandoned?.probe ?? 0) + d });
    const switched = prev !== null && prev !== rung;
    const dir = prev !== null && rung > prev ? 'down' : 'up';
    const why =
      mode === 'fixed'
        ? 'The fixed player always asks for 1080p.'
        : abandoned
          ? `It starts ${LADDER[abandoned.rung].name}, but after ${abandoned.probe.toFixed(1)} s the download is clearly too slow to beat the ${(before + abandoned.probe).toFixed(1)} s buffer, so it aborts and re-requests the segment at ${LADDER[rung].name}.`
          : guarded
            ? `Estimate ${e.toFixed(1)} Mbps, but only ${before.toFixed(1)} s is buffered (less than one segment), so the buffer guard steps one rung lower to ${LADDER[rung].name}.`
            : `${i === 0 ? 'No samples yet, so it assumes' : 'Throughput estimate (harmonic mean of the last 3 segments):'} ${e.toFixed(1)} Mbps × ${SAFETY} = ${(e * SAFETY).toFixed(1)} Mbps, and the highest rung under that is ${LADDER[rung].name}.`;
    const bwEnd = bandwidth(profile, start + (abandoned?.probe ?? 0) + d - 0.01);
    const midDrop = bwEnd < bw * 0.6 ? ` Bandwidth collapsed to ${bwEnd} Mbps in the middle of this download${stall > 0 ? '' : `, but the ${(before).toFixed(1)} s buffer absorbed the slow transfer`}.` : '';
    frames.push({
      caption: `Segment #${i} (t ≈ ${start.toFixed(1)} s, bandwidth ${bw} Mbps): ${why}${switched ? ` The player switches ${dir} from ${LADDER[prev!].name} at the segment boundary.` : ''}${midDrop} The download took ${d.toFixed(1)} s for ${seg} s of video${
        stall > 0 ? `: the buffer ran dry and playback STALLED for ${stall.toFixed(1)} s` : ''
      }. Buffer now ${buffer.toFixed(1)} s.`,
      predict: (() => {
        if (i + 1 >= n) return undefined;
        const now = bandwidth(profile, t);
        for (let x = t; x < t + (LADDER[rung].mbps * seg) / now; x += 0.25) {
          const b = bandwidth(profile, x);
          if (b < now * 0.5) return `Bandwidth will fall from ${now} to ${b} Mbps during the next download. Will playback stall?`;
        }
        return undefined;
      })(),
      seq: i,
      rung,
      estimate: e,
      bw,
      buffer,
      stallTotal,
      samples: samples.map((x) => ({ ...x })),
      switched,
      latency,
    });
    prev = rung;
  }

  const switches = samples.filter((s, i) => i > 0 && s.rung !== samples[i - 1].rung).length;
  const avgMbps = samples.reduce((a, s) => a + LADDER[s.rung].mbps, 0) / samples.length;
  frames.push({
    caption:
      mode === 'fixed'
        ? `Result: always 1080p, but ${stallTotal.toFixed(1)} s of stalls${stallTotal > 0 ? ' whenever bandwidth fell below 5 Mbps' : ''}. Viewers hate rebuffering far more than a softer picture.`
        : `Result: ${stallTotal > 0 ? `${stallTotal.toFixed(1)} s of stalls` : 'no stalls'}, ${switches} rendition switch${switches === 1 ? '' : 'es'}, average ${avgMbps.toFixed(1)} Mbps. Shorter segments react faster and cut latency (~${latency} s here) at the cost of more requests and worse compression; longer ones buffer more but lag the live edge.`,
    seq: n,
    rung: null,
    estimate: harmonic(),
    bw: bandwidth(profile, t),
    buffer,
    stallTotal,
    samples: samples.map((s) => ({ ...s })),
    switched: false,
    latency,
  });
  return frames;
}
