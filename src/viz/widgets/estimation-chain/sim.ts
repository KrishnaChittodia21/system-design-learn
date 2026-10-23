// Pure back-of-envelope chain: DAU → average QPS → peak QPS → storage → bandwidth → servers.
// Every step is computed from the previous ones so the learner sees the numbers flow.
import type { BaseFrame } from '../../core';

export const DAU_STEPS = [1e6, 5e6, 10e6, 50e6, 100e6, 300e6, 500e6, 1e9];
export const RECORD_STEPS = [100, 200, 500, 1_000, 2_000, 5_000, 10_000];
export const RATIO_STEPS = [1, 2, 5, 10, 20, 50, 100];

/** Fixed assumptions, stated in the captions. */
export const SECONDS_PER_DAY = 86_400;
export const GROWTH = 0.3; // 30% year-over-year traffic growth
export const REPLICATION = 3; // primary + 2 replicas / RF=3
export const OVERHEAD = 1.5; // index + row/page overhead (content: 1.3–2×)
export const DISK_FILL = 0.7; // never plan disks above ~70% full
export const CPU_MS = 10; // CPU time per request
export const TARGET_UTIL = 0.6; // plan cores at 60% so a lost AZ lands at 90%
export const VCPU_PER_POD = 2;
export const AZS = 3;
export const NIC_GBPS = 10;

export interface Params {
  dauIdx: number;
  /** requests per user per day */
  actions: number;
  ratioIdx: number;
  peak: number;
  recordIdx: number;
  /** response payload in KB */
  respKb: number;
  years: number;
}

export const DEFAULT_PARAMS: Params = { dauIdx: 4, actions: 10, ratioIdx: 3, peak: 3, recordIdx: 3, respKb: 20, years: 5 };

export interface Numbers {
  dau: number;
  ratio: number;
  record: number;
  perDay: number;
  avgQps: number;
  quickQps: number;
  readQps: number;
  writeQps: number;
  peakQps: number;
  peakRead: number;
  peakWrite: number;
  writesPerDay: number;
  bytesPerDay: number;
  /** Σ (1+g)^k for k < years */
  growthSum: number;
  rawBytes: number;
  storedBytes: number;
  diskBytes: number;
  egressBytesPerSec: number;
  egressGbps: number;
  ingressBytesPerSec: number;
  ingressGbps: number;
  nicsAt70: number;
  busyCores: number;
  vcpus: number;
  pods: number;
  podsPerAz: number;
  /** utilisation on the surviving AZs after losing one */
  azLossUtil: number;
}

export function compute(p: Params): Numbers {
  const dau = DAU_STEPS[p.dauIdx];
  const ratio = RATIO_STEPS[p.ratioIdx];
  const record = RECORD_STEPS[p.recordIdx];
  const perDay = dau * p.actions;
  const avgQps = perDay / SECONDS_PER_DAY;
  const quickQps = perDay / 1e5;
  const writeShare = 1 / (ratio + 1);
  const writeQps = avgQps * writeShare;
  const readQps = avgQps - writeQps;
  const peakQps = avgQps * p.peak;
  const peakWrite = writeQps * p.peak;
  const peakRead = readQps * p.peak;
  const writesPerDay = perDay * writeShare;
  const bytesPerDay = writesPerDay * record;
  let growthSum = 0;
  for (let k = 0; k < p.years; k++) growthSum += (1 + GROWTH) ** k;
  const rawBytes = bytesPerDay * 365 * growthSum;
  const storedBytes = rawBytes * REPLICATION * OVERHEAD;
  const diskBytes = storedBytes / DISK_FILL;
  const egressBytesPerSec = peakRead * p.respKb * 1_000;
  const egressGbps = (egressBytesPerSec * 8) / 1e9;
  const ingressBytesPerSec = peakWrite * record;
  const ingressGbps = (ingressBytesPerSec * 8) / 1e9;
  const nicsAt70 = Math.max(1, Math.ceil(egressGbps / (NIC_GBPS * 0.7)));
  const busyCores = (peakQps * CPU_MS) / 1_000;
  const vcpus = busyCores / TARGET_UTIL;
  const pods = Math.max(AZS, Math.ceil(vcpus / VCPU_PER_POD / AZS) * AZS);
  const podsPerAz = pods / AZS;
  const azLossUtil = (busyCores / (((pods * (AZS - 1)) / AZS) * VCPU_PER_POD));
  return {
    dau,
    ratio,
    record,
    perDay,
    avgQps,
    quickQps,
    readQps,
    writeQps,
    peakQps,
    peakRead,
    peakWrite,
    writesPerDay,
    bytesPerDay,
    growthSum,
    rawBytes,
    storedBytes,
    diskBytes,
    egressBytesPerSec,
    egressGbps,
    ingressBytesPerSec,
    ingressGbps,
    nicsAt70,
    busyCores,
    vcpus,
    pods,
    podsPerAz,
    azLossUtil,
  };
}

// ---------- formatting (decimal units, ~3 significant figures) ----------
function sig(n: number): string {
  if (n === 0) return '0';
  if (n >= 100) return Math.round(n).toLocaleString('en-US');
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function fmtCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${sig(n / 1e9)}B`;
  if (a >= 1e6) return `${sig(n / 1e6)}M`;
  if (a >= 1e4) return `${sig(n / 1e3)}K`;
  return sig(n);
}

export function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let u = 0;
  let v = n;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${sig(v)} ${units[u]}`;
}

export function fmtBits(gbps: number): string {
  if (gbps >= 1000) return `${sig(gbps / 1000)} Tbps`;
  if (gbps >= 1) return `${sig(gbps)} Gbps`;
  return `${sig(gbps * 1000)} Mbps`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------- the chain ----------
export type StepId = 'inputs' | 'avg' | 'split' | 'peak' | 'daily' | 'storage' | 'egress' | 'ingress' | 'servers' | 'summary';
export const STEPS: StepId[] = ['inputs', 'avg', 'split', 'peak', 'daily', 'storage', 'egress', 'ingress', 'servers', 'summary'];

export interface Frame extends BaseFrame {
  step: StepId;
  n: Numbers;
}

export function simulate(p: Params): Frame[] {
  const n = compute(p);
  const f = (step: StepId, caption: string, predict?: string): Frame => ({ step, n, caption, predict });
  const quickErr = Math.round((n.quickQps / n.avgQps - 1) * 100);
  const saturates = n.egressGbps > NIC_GBPS * 0.7;
  return [
    f(
      'inputs',
      `Start from people, not servers: ${fmtCount(n.dau)} daily active users making ${p.actions} requests a day, ${n.ratio}:1 reads to writes, ${p.peak}× peak. Fixed assumptions: ${CPU_MS} ms CPU per request, ${REPLICATION}× replication, ${OVERHEAD}× index overhead, ${Math.round(GROWTH * 100)}% yearly growth.`,
      `${fmtCount(n.perDay)} requests a day. Without a calculator: roughly how many per second?`,
    ),
    f(
      'avg',
      `Average QPS = ${fmtCount(n.dau)} × ${p.actions} ÷ 86,400 s = ${fmtCount(n.avgQps)}/s. The ÷10⁵ shortcut gives ${fmtCount(n.quickQps)}/s, ${Math.abs(quickErr)}% ${quickErr < 0 ? 'low' : 'high'}, which is close enough to decide with.`,
    ),
    f(
      'split',
      `Split by the ${n.ratio}:1 read:write ratio: ${fmtCount(n.readQps)} reads/s and ${fmtCount(n.writeQps)} writes/s on average. Reads and writes scale with different tools (cache and replicas vs partitioning), so size them separately.`,
      `Users do not spread their visits evenly across the day. What multiplier do you apply, and to which number?`,
    ),
    f(
      'peak',
      `Peak QPS = average × ${p.peak} = ${fmtCount(n.peakQps)}/s (${fmtCount(n.peakRead)} reads, ${fmtCount(n.peakWrite)} writes). Size compute and network for the peak; size storage from the daily total.`,
    ),
    f(
      'daily',
      `New data per day = ${fmtCount(n.writesPerDay)} writes × ${fmtBytes(n.record)} = ${fmtBytes(n.bytesPerDay)}/day of raw records. This is the smallest storage number you will see.`,
      `Over ${p.years} year${p.years > 1 ? 's' : ''}, with growth, replicas and indexes, how many times bigger does the disk bill get?`,
    ),
    f(
      'storage',
      `${p.years} years at ${Math.round(GROWTH * 100)}% growth is ${sig(n.growthSum)}× one year of today’s volume, so raw = ${fmtBytes(n.rawBytes)}. ×${REPLICATION} replicas ×${OVERHEAD} overhead = ${fmtBytes(n.storedBytes)}, and at ${pct(DISK_FILL)} fill you buy ${fmtBytes(n.diskBytes)}: ${sig(n.diskBytes / n.rawBytes)}× the raw data.`,
    ),
    f(
      'egress',
      `Peak egress = ${fmtCount(n.peakRead)} reads/s × ${p.respKb} KB = ${fmtBytes(n.egressBytesPerSec)}/s. Multiply by 8 for the network: ${fmtBits(n.egressGbps)}. ${saturates ? `That is over 70% of a ${NIC_GBPS} Gbps NIC, so you need ${n.nicsAt70} edge nodes, compression or a CDN.` : n.egressGbps > NIC_GBPS * 0.35 ? `One ${NIC_GBPS} Gbps NIC would run at ${pct(n.egressGbps / NIC_GBPS)} before TCP/TLS overhead: fine for a fleet, risky for a single box.` : `That fits comfortably under a ${NIC_GBPS} Gbps NIC.`}`,
    ),
    f(
      'ingress',
      `Peak ingress = ${fmtCount(n.peakWrite)} writes/s × ${fmtBytes(n.record)} = ${fmtBits(n.ingressGbps)}. Ingress is usually small; egress is where NIC limits and the cloud bill bite.`,
      `Each request costs ${CPU_MS} ms of CPU. How many cores does ${fmtCount(n.peakQps)}/s need, and why not run them at 100%?`,
    ),
    f(
      'servers',
      `Busy cores = ${fmtCount(n.peakQps)}/s × ${CPU_MS} ms = ${fmtCount(n.busyCores)}. Planned at ${pct(TARGET_UTIL)} utilisation that is ${fmtCount(n.vcpus)} vCPU, so ${n.pods} pods of ${VCPU_PER_POD} vCPU (${n.podsPerAz} per AZ). Lose one of ${AZS} AZs and the survivors run at ${pct(n.azLossUtil)}: tight but alive.`,
    ),
    f(
      'summary',
      `Say it in one breath: “~${fmtCount(n.peakQps)} peak QPS, ~${fmtBytes(n.diskBytes)} of disk over ${p.years} years, ~${fmtBits(n.egressGbps)} peak egress, ~${n.pods} small pods.” Round hard; what matters is which number forces a design decision.`,
    ),
  ];
}
