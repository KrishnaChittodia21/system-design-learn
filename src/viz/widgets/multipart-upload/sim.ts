// Pure, deterministic model of an S3 multipart upload driven by a browser with presigned URLs.
// Discrete-event simulation: N parallel streams pull parts from a queue; total uplink bandwidth
// is shared, each TCP stream is also capped (long RTT), one part fails mid-flight and is retried
// on its own; then CompleteMultipartUpload stitches the parts (or the upload is abandoned).
import type { BaseFrame } from '../../core';

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;
export const MAX_PARTS = 10_000;
export const MIN_PART_MIB = 5;
export const UPLINK_MBPS = 200;
export const STREAM_CAP_MBPS = 50; // one TCP connection over a long-RTT path

export type Ending = 'complete' | 'abandon';

export interface Params {
  fileGiB: number;
  partMiB: number;
  streams: number;
  fail: boolean;
  ending: Ending;
}

export type PartState = 'pending' | 'uploading' | 'done' | 'failed';

export function partCount(p: Params): number {
  return Math.ceil((p.fileGiB * GiB) / (p.partMiB * MiB));
}
export function perStreamMbps(streams: number): number {
  return Math.min(STREAM_CAP_MBPS, UPLINK_MBPS / streams);
}
export function aggregateMbps(streams: number): number {
  return perStreamMbps(streams) * streams;
}
/** seconds to send one full part on one stream */
export function partSeconds(p: Params): number {
  return (p.partMiB * MiB * 8) / (perStreamMbps(p.streams) * 1e6);
}
/** seconds to resend a failed part: one part's bytes at the per-stream rate */
export const retryCostSeconds = partSeconds;
/** ideal transfer time for the whole file (no failures) */
export function idealSeconds(p: Params): number {
  return (p.fileGiB * GiB * 8) / (aggregateMbps(p.streams) * 1e6);
}

export interface Frame extends BaseFrame {
  phase: 'create' | 'presign' | 'upload' | 'complete' | 'abandon' | 'invalid';
  /** simulated time in seconds */
  t: number;
  states: PartState[];
  /** 0..1 progress of each part */
  progress: number[];
  /** bytes uploaded successfully (excluding wasted retry bytes) */
  doneParts: number;
  wastedMiB: number;
  visible: boolean;
}

interface Ev {
  t: number;
  type: 'finish' | 'fail';
  part: number;
  stream: number;
}

/** Run the event simulation; return per-part start/end times and the failed attempt. */
export function runUpload(p: Params): { start: number[]; end: number[]; failedPart: number; failAt: number; failStart: number; total: number } {
  const n = partCount(p);
  const dur = partSeconds(p);
  const lastBytes = p.fileGiB * GiB - (n - 1) * p.partMiB * MiB;
  const durOf = (i: number) => (i === n - 1 ? (lastBytes / (p.partMiB * MiB)) * dur : dur);
  const failedPart = p.fail ? Math.min(n - 1, Math.floor(n * 0.3)) : -1;
  const start = new Array<number>(n).fill(-1);
  const end = new Array<number>(n).fill(-1);
  const queue: number[] = Array.from({ length: n }, (_, i) => i);
  const events: Ev[] = [];
  let failAt = -1;
  let failStart = -1;
  let failedOnce = false;
  const launch = (stream: number, t: number) => {
    const part = queue.shift();
    if (part === undefined) return;
    start[part] = t;
    if (part === failedPart && !failedOnce) {
      failedOnce = true;
      failStart = t;
      failAt = t + durOf(part) * 0.6; // connection reset 60% of the way through
      events.push({ t: failAt, type: 'fail', part, stream });
    } else events.push({ t: t + durOf(part), type: 'finish', part, stream });
  };
  for (let s = 0; s < Math.min(p.streams, n); s++) launch(s, 0);
  let total = 0;
  while (events.length) {
    events.sort((a, b) => a.t - b.t || a.part - b.part);
    const e = events.shift()!;
    total = Math.max(total, e.t);
    if (e.type === 'fail') queue.unshift(e.part); // retry just this part, next free stream
    else end[e.part] = e.t;
    launch(e.stream, e.t);
  }
  return { start, end, failedPart, failAt, failStart, total };
}

const mmss = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${s.toFixed(1)}s`);
export const fmtTime = mmss;

export function simulate(p: Params): Frame[] {
  const n = partCount(p);
  const frames: Frame[] = [];
  if (p.partMiB < MIN_PART_MIB || n > MAX_PARTS) {
    frames.push({
      phase: 'invalid',
      t: 0,
      states: [],
      progress: [],
      doneParts: 0,
      wastedMiB: 0,
      visible: false,
      caption: `${p.fileGiB} GiB in ${p.partMiB} MiB parts = ${n.toLocaleString('en-US')} parts, over S3's ${MAX_PARTS.toLocaleString('en-US')}-part cap (${MIN_PART_MIB} MiB × 10,000 ≈ 48.8 GiB max). CreateMultipartUpload would work, but part 10,001 is rejected: pick bigger parts.`,
    });
    return frames;
  }
  const run = runUpload(p);
  const pending = (): PartState[] => new Array<PartState>(n).fill('pending');
  const zero = () => new Array<number>(n).fill(0);
  frames.push({
    phase: 'create',
    t: 0,
    states: pending(),
    progress: zero(),
    doneParts: 0,
    wastedMiB: 0,
    visible: false,
    caption: `Client asks your API to upload ${p.fileGiB} GiB. The API calls CreateMultipartUpload → UploadId "VXBsb2Fk…". Nothing is visible in the bucket yet. ${n.toLocaleString('en-US')} parts of ${p.partMiB} MiB.`,
    predict: `With ${p.streams} stream${p.streams > 1 ? 's' : ''} sharing a ${UPLINK_MBPS} Mbps uplink, how long will it take, and what does one dropped connection cost?`,
  });
  frames.push({
    phase: 'presign',
    t: 0,
    states: pending(),
    progress: zero(),
    doneParts: 0,
    wastedMiB: 0,
    visible: false,
    caption: `The API presigns one UploadPart URL per part (PUT …?partNumber=1&uploadId=…&X-Amz-Expires=900&X-Amz-Signature=…) and returns them. From here the bytes go browser → S3 directly; your pods handle a few KB of JSON, not ${p.fileGiB} GiB.`,
  });

  const SLICES = 8;
  const marks = Array.from({ length: SLICES }, (_, k) => (run.total * (k + 1)) / SLICES);
  if (run.failAt > 0 && !marks.some((m) => Math.abs(m - run.failAt) < 1e-9)) marks.push(run.failAt);
  marks.sort((a, b) => a - b);
  for (const t of marks) {
    const states: PartState[] = [];
    const progress: number[] = [];
    let doneParts = 0;
    for (let i = 0; i < n; i++) {
      let st: PartState = 'pending';
      let pr = 0;
      if (i === run.failedPart && t <= run.failAt + 1e-9) {
        // first attempt of the part that will fail
        if (Math.abs(t - run.failAt) < 1e-9) {
          st = 'failed';
          pr = 0.6;
        } else if (t >= run.failStart) {
          st = 'uploading';
          pr = ((t - run.failStart) / (run.failAt - run.failStart)) * 0.6;
        }
      } else if (run.end[i] >= 0 && run.end[i] <= t + 1e-9) {
        st = 'done';
        pr = 1;
        doneParts++;
      } else if (run.start[i] >= 0 && run.start[i] <= t) {
        st = 'uploading';
        pr = (t - run.start[i]) / (run.end[i] - run.start[i]);
      }
      states.push(st);
      progress.push(pr);
    }
    const isFail = Math.abs(t - run.failAt) < 1e-9;
    const wasted = run.failAt > 0 && t >= run.failAt - 1e-9 ? p.partMiB * 0.6 : 0;
    frames.push({
      phase: 'upload',
      t,
      states,
      progress,
      doneParts,
      wastedMiB: wasted,
      visible: false,
      caption: isFail
        ? `t = ${mmss(t)}: the connection carrying part ${run.failedPart + 1} resets at 60%. Only that part is retried (${(p.partMiB * 0.6).toFixed(1)} MiB wasted, ~${mmss(retryCostSeconds(p))} to resend on one stream, ${((p.partMiB * MiB * 8) / (UPLINK_MBPS * 1e6)).toFixed(1)} s of total uplink time); the ${doneParts} finished part${doneParts === 1 ? '' : 's'} and ${states.filter((s) => s === 'uploading').length} other in-flight upload${states.filter((s) => s === 'uploading').length === 1 ? '' : 's'} are untouched. A single PUT would restart all ${p.fileGiB} GiB.`
        : `t = ${mmss(t)}: ${doneParts.toLocaleString('en-US')}/${n.toLocaleString('en-US')} parts done. ${p.streams} stream${p.streams > 1 ? 's' : ''} × ${perStreamMbps(p.streams).toFixed(0)} Mbps = ${aggregateMbps(p.streams).toFixed(0)} Mbps` +
          (aggregateMbps(p.streams) < UPLINK_MBPS ? ` (one TCP stream tops out at ${STREAM_CAP_MBPS} Mbps here, so more streams would help)` : ` (uplink saturated: more streams will not go faster)`) +
          `. Each part returns an ETag the client keeps.`,
    });
  }

  const total = run.total;
  if (p.ending === 'complete') {
    frames.push({
      phase: 'complete',
      t: total,
      states: new Array<PartState>(n).fill('done'),
      progress: new Array<number>(n).fill(1),
      doneParts: n,
      wastedMiB: run.failAt > 0 ? p.partMiB * 0.6 : 0,
      visible: true,
      caption: `All parts in after ${mmss(total)} (ideal ${mmss(idealSeconds(p))}${run.failAt > 0 ? ', the retry cost the difference' : ''}). The client sends the ETags in part order; the API calls CompleteMultipartUpload and S3 stitches them into one object, now visible. Its ETag is md5(concat(part md5s))-${n}, not the file's MD5.`,
    });
  } else {
    frames.push({
      phase: 'abandon',
      t: total,
      states: new Array<PartState>(n).fill('done'),
      progress: new Array<number>(n).fill(1),
      doneParts: n,
      wastedMiB: 0,
      visible: false,
      caption: `The tab closes before CompleteMultipartUpload. The ${p.fileGiB} GiB of parts stay in S3: billed, but invisible to ListObjects. Only a lifecycle rule (AbortIncompleteMultipartUpload after 7 days) or an explicit Abort frees them.`,
    });
  }
  return frames;
}
