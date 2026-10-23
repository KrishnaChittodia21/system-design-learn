// Pure model of one global limit enforced from three regions (no React, Node-testable).
// Time runs in 100 ms ticks; the limit is per 1 s window.
//   central : every request asks one counter in us-east → exact, but each non-local request pays a
//             cross-region round trip.
//   static  : each region may admit limit / 3 per second locally → no extra latency, no overshoot,
//             but capacity is stranded when traffic is skewed.
//   leasing : each region admits from a LOCAL token bucket. When it drops below half a batch it asks
//             the coordinator for another batch; the grant arrives one tick (≈ one RTT) later. The
//             coordinator grants at most `limit` tokens per window, but tokens already leased are
//             spent whenever they are needed, so a window can overshoot by at most regions × batch.
import type { BaseFrame } from '../../core';

export type Design = 'central' | 'static' | 'leasing';

export interface Params {
  design: Design;
  /** % of traffic in the busiest region */
  skew: number;
  batch: number;
}

export const DEFAULT_PARAMS: Params = { design: 'leasing', skew: 80, batch: 10 };

export const LIMIT = 100;
export const DEMAND = 130;
export const SECONDS = 6;
export const TICKS = 10;
export const SHIFT_AT = 3;
export const REGIONS = ['us-east', 'eu-west', 'ap-south'] as const;
/** added latency (ms) for a request in each region to reach the us-east counter */
export const RTT_TO_CENTRAL = [2, 80, 150];

export interface RegionSecond {
  demand: number;
  admitted: number;
  rejected: number;
  /** leased tokens left in the local bucket at the end of the second */
  tokens: number;
  leases: number;
}

export interface Frame extends BaseFrame {
  second: number;
  regions: RegionSecond[] | null;
  /** global admitted per completed second */
  history: number[];
  /** coordinator tokens granted in this window */
  granted: number;
  latency: number;
}

export function demandFor(second: number, skew: number): number[] {
  const busy = second < SHIFT_AT ? 0 : 2;
  return REGIONS.map((_, r) => {
    const share = r === busy ? skew : (100 - skew) / 2;
    return Math.round((DEMAND * share) / 100);
  });
}

/** arrivals in tick k of a second, spreading `d` requests evenly */
const arrivals = (d: number, k: number) => Math.floor((d * (k + 1)) / TICKS) - Math.floor((d * k) / TICKS);

export function simulate({ design, skew, batch }: Params): Frame[] {
  const frames: Frame[] = [];
  const history: number[] = [];
  const tokens = [0, 0, 0];
  const pending = [false, false, false];
  let latencySum = 0;
  let latencyN = 0;

  const name =
    design === 'central' ? 'one central counter in us-east' : design === 'static' ? `a static split of ${Math.floor(LIMIT / 3)}–${Math.ceil(LIMIT / 3)} per region` : `local buckets leasing batches of ${batch} tokens`;
  frames.push({
    caption: `The key may make ${LIMIT} requests/s globally. Clients send ${DEMAND}/s (more than allowed), ${skew}% of it from one region, and at t=${SHIFT_AT}s the busy region moves from us-east to ap-south. Design: ${name}.`,
    second: -1,
    regions: null,
    history: [],
    granted: 0,
    latency: 0,
  });

  for (let s = 0; s < SECONDS; s++) {
    const dem = demandFor(s, skew);
    const rs: RegionSecond[] = dem.map((d) => ({ demand: d, admitted: 0, rejected: 0, tokens: 0, leases: 0 }));
    let windowCount = 0;
    let granted = 0;
    const staticQuota = REGIONS.map((_, r) => Math.floor(LIMIT / 3) + (r < LIMIT % 3 ? 1 : 0));
    for (let k = 0; k < TICKS; k++) {
      // lease grants requested in the previous tick arrive now
      if (design === 'leasing') {
        for (let r = 0; r < 3; r++) {
          if (pending[r]) {
            pending[r] = false;
            const g = Math.min(batch, LIMIT - granted);
            if (g > 0) {
              tokens[r] += g;
              granted += g;
              rs[r].leases++;
            }
          }
        }
      }
      for (let r = 0; r < 3; r++) {
        const a = arrivals(dem[r], k);
        for (let i = 0; i < a; i++) {
          let ok = false;
          if (design === 'central') {
            ok = windowCount < LIMIT;
            latencySum += RTT_TO_CENTRAL[r];
            latencyN++;
          } else if (design === 'static') {
            ok = rs[r].admitted < staticQuota[r];
          } else if (tokens[r] > 0) {
            tokens[r]--;
            ok = true;
          }
          if (ok) {
            rs[r].admitted++;
            windowCount++;
          } else rs[r].rejected++;
        }
        if (design === 'leasing' && !pending[r] && tokens[r] < batch / 2 && dem[r] > 0) pending[r] = true;
      }
    }
    for (let r = 0; r < 3; r++) rs[r].tokens = tokens[r];
    history.push(windowCount);
    const total = windowCount;
    const busiest = rs.reduce((b, x, i) => (x.demand > rs[b].demand ? i : b), 0);
    const parts: string[] = [];
    if (design === 'central') parts.push(`Exactly ${total} admitted. Every eu-west and ap-south request paid an extra ${RTT_TO_CENTRAL[1]}–${RTT_TO_CENTRAL[2]} ms to reach us-east, and if us-east is down every region is blind.`);
    else if (design === 'static')
      parts.push(
        `${REGIONS[busiest]} wants ${rs[busiest].demand} but may only admit ${staticQuota[busiest]}, while the quiet regions leave ${rs.reduce((a, x, i) => a + Math.max(0, staticQuota[i] - x.admitted), 0)} of their shares unused: ${total} of ${LIMIT} admitted.`,
      );
    else {
      const over = total - LIMIT;
      const stranded = rs.reduce((a, x, i) => (i === busiest ? a : a + x.tokens), 0);
      const why =
        stranded >= LIMIT - total
          ? `leased tokens sat unused in the quiet regions (${stranded} still held)`
          : `the busy region ran dry while waiting a round trip for each ${batch}-token batch`;
      parts.push(
        `The coordinator granted ${granted} tokens in ${rs.reduce((a, x) => a + x.leases, 0)} leases; regions admitted ${total}${
          over > 0 ? `, ${over} over the limit because tokens leased earlier were spent this second` : total < LIMIT ? `, ${LIMIT - total} short of the limit because ${why}` : ''
        }. Every check was local: no round trip on the hot path.`,
      );
    }
    frames.push({
      caption: `Second ${s}${s === SHIFT_AT ? ' (traffic shifts to ap-south)' : ''}: ${parts.join(' ')}`,
      predict: s === SHIFT_AT - 1 ? `Next second most traffic comes from ap-south instead. How does ${design === 'static' ? 'the static split' : design === 'central' ? 'the central counter' : 'leasing'} cope?` : undefined,
      second: s,
      regions: rs,
      history: [...history],
      granted,
      latency: latencyN ? Math.round(latencySum / latencyN) : 0,
    });
  }

  const max = Math.max(...history);
  const min = Math.min(...history);
  const avgLat = latencyN ? Math.round(latencySum / latencyN) : 0;
  frames.push({
    caption:
      design === 'central'
        ? `Result: always exactly ${LIMIT}/s, but the average request paid ~${avgLat} ms extra and one region is a single point of failure. Worth it only for hard money or abuse limits (or route the key to a home region).`
        : design === 'static'
          ? `Result: never over the limit, zero added latency, but only ${min}–${max} of ${LIMIT}/s were usable while traffic was skewed. Static splits waste capacity.`
          : `Result: ${min}–${max} admitted per second against a limit of ${LIMIT} with zero hot-path latency. Overshoot is bounded by ${REGIONS.length} regions × ${batch}-token batches (${REGIONS.length * batch}). ${
              batch * TICKS < 0.8 * Math.max(...demandFor(0, skew)) ? 'Batches this small cannot feed the busy region at one lease per round trip, so it is starved. ' : batch >= 20 ? 'Batches this large strand and overspend more tokens. ' : ''
            }Production systems size batches at ~1–2% of the limit and adapt each region's share to its reported demand.`,
    second: SECONDS,
    regions: frames[frames.length - 1].regions,
    history: [...history],
    granted: 0,
    latency: avgLat,
  });
  return frames;
}
