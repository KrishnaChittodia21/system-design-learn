// Pure tick model (1 tick = 2 minutes) of releasing a version with a given error rate through
// rolling update, blue/green, or an automated canary, against a 99.9% SLO.
//  - rolling / blue-green are protected only by the multi-window burn-rate page (14.4× over 1 h
//    AND 5 min) plus a human who takes 10 minutes to act;
//  - the canary is compared every tick with a same-size baseline; it promotes only with enough
//    requests and no significant difference, and rolls back automatically on a failed check.
import type { BaseFrame } from '../../core';

export type Strategy = 'rolling' | 'bluegreen' | 'canary';

export interface Params {
  strategy: Strategy;
  /** error rate of the new version, percent */
  newErr: number;
}

export const TICK_MIN = 2;
export const TICKS = 30;
export const RPS = 200;
export const REQ_PER_TICK = RPS * 60 * TICK_MIN; // 24,000
export const BASE_ERR = 0.1; // percent
export const SLO = 99.9;
export const BUDGET = Math.round((1 - SLO / 100) * RPS * 30 * 24 * 3600); // 518,400 bad requests / 30 days
export const PAGE_BURN = 14.4;
export const LONG_TICKS = 30; // 1 h
export const SHORT_TICKS = 3; // ~5 min
export const HUMAN_TICKS = 5; // 10 min from page to action
export const PODS = 10;
export const CANARY_STEPS = [1, 10, 50, 100]; // percent of traffic
export const STEP_TICKS = 5; // 10 min per canary step
export const MIN_CANARY_REQ = 1000; // fail closed: never promote on fewer requests
export const ERR_OPTIONS = [0.1, 0.3, 1, 3, 10];

export interface Frame extends BaseFrame {
  tick: number;
  /** share of traffic on the new version (0..1), history */
  share: number[];
  /** fleet error rate in percent, history */
  err: number[];
  /** excess bad requests caused by the release, cumulative */
  excess: number;
  events: { tick: number; label: string; tone: 'good' | 'bad' | 'warn' | 'info' }[];
  phase: 'deploying' | 'paged' | 'rolling-back' | 'rolled-back' | 'done';
}

export function simulate({ strategy, newErr }: Params): Frame[] {
  const E = newErr / 100;
  const p0 = BASE_ERR / 100;
  const pageThreshold = (PAGE_BURN * BASE_ERR) / 100;
  const share: number[] = [];
  const err: number[] = [];
  const events: Frame['events'] = [];
  const frames: Frame[] = [];
  let excess = 0;
  let pagedAt = -1;
  let rollbackStart = -1;
  let rolledBackAt = -1;
  let doneAt = -1;
  let canaryStep = 0;
  let stepStart = 0;
  let canN = 0;
  let canErr = 0;
  let s = 0;

  const how =
    strategy === 'rolling'
      ? `Rolling update: one of ${PODS} pods replaced every ${TICK_MIN} min. Readiness probes pass (the bug is in responses, not health), so it keeps going.`
      : strategy === 'bluegreen'
        ? 'Blue/green: green is deployed and warmed, then the router flips 100% of traffic at once; blue stays up for an instant switch back.'
        : `Canary: ${CANARY_STEPS.join('% → ')}% of traffic, ${STEP_TICKS * TICK_MIN} min per step, compared every ${TICK_MIN} min with a same-size baseline; promote only with ≥ ${MIN_CANARY_REQ.toLocaleString('en-US')} requests and no significant difference, roll back automatically otherwise.`;
  frames.push({
    tick: -1,
    share: [],
    err: [],
    excess: 0,
    events: [],
    phase: 'deploying',
    caption: `${RPS} req/s, SLO ${SLO}% → a 30-day budget of ${BUDGET.toLocaleString('en-US')} bad requests. The current version fails ${BASE_ERR}% of requests; the new one fails ${newErr}%${newErr <= BASE_ERR ? ' (a good release)' : ''}. ${how} Burn-rate page: ${PAGE_BURN}× (≥ ${+(pageThreshold * 100).toFixed(2)}% errors) over both 1 h and 5 min.`,
  });

  for (let t = 0; t < TICKS; t++) {
    const notes: string[] = [];
    // ---- decide traffic share for this tick
    if (rollbackStart >= 0) {
      if (strategy === 'rolling') s = Math.max(0, s - 0.4); // rollout undo, 4 pods per tick
      else s = 0;
      if (s === 0 && rolledBackAt < 0) {
        rolledBackAt = t;
        events.push({ tick: t, label: 'rolled back', tone: 'warn' });
        notes.push('Rollback complete: all traffic on the old version.');
      }
    } else if (doneAt < 0) {
      if (strategy === 'rolling') s = Math.min(1, (t + 1) / PODS);
      else if (strategy === 'bluegreen') s = 1;
      else {
        if (t > 0 && t - stepStart >= STEP_TICKS && canaryStep < CANARY_STEPS.length - 1) {
          if (canN >= MIN_CANARY_REQ) {
            canaryStep++;
            stepStart = t;
            events.push({ tick: t, label: `→${CANARY_STEPS[canaryStep]}%`, tone: 'info' });
            notes.push(`Analysis passed with ${Math.round(canN).toLocaleString('en-US')} canary requests → promote to ${CANARY_STEPS[canaryStep]}%.`);
          } else notes.push(`Only ${Math.round(canN)} canary requests so far — not enough evidence, so the step is extended (fail closed).`);
        }
        s = CANARY_STEPS[canaryStep] / 100;
      }
      if (s >= 1 && doneAt < 0 && (strategy !== 'canary' || canaryStep === CANARY_STEPS.length - 1)) {
        doneAt = t;
        events.push({ tick: t, label: strategy === 'bluegreen' ? 'switched' : '100%', tone: E > p0 ? 'bad' : 'good' });
      }
    }

    // ---- traffic and errors this tick
    const fleetErr = s * E + (1 - s) * p0;
    err.push(fleetErr * 100);
    share.push(s);
    excess += REQ_PER_TICK * s * Math.max(0, E - p0);

    // ---- canary analysis (canary vs equal-size baseline)
    if (strategy === 'canary' && rollbackStart < 0 && s > 0 && s < 1) {
      const n = REQ_PER_TICK * s;
      canN += n;
      canErr += n * E;
      const expected = canN * p0;
      if (canErr >= 5 && canErr >= expected + 3 * Math.sqrt(expected)) {
        rollbackStart = t;
        events.push({ tick: t, label: 'canary ✗', tone: 'bad' });
        notes.push(
          `Canary check fails: ${canErr.toFixed(1)} errors in ${Math.round(canN).toLocaleString('en-US')} requests vs ${expected.toFixed(1)} expected from the baseline (> 3σ). Automatic rollback.`,
        );
      }
    }

    // ---- multi-window burn-rate page (rolling / blue-green; also guards a canary at 100%)
    if (pagedAt < 0 && rollbackStart < 0) {
      const hist = (k: number) => {
        let sum = 0;
        for (let i = 0; i < k; i++) sum += t - i >= 0 ? err[t - i] / 100 : p0; // before the deploy: baseline
        return sum / k;
      };
      if (hist(LONG_TICKS) >= pageThreshold && hist(SHORT_TICKS) >= pageThreshold) {
        pagedAt = t;
        events.push({ tick: t, label: 'PAGE', tone: 'bad' });
        notes.push(`Burn-rate page fires: ${(hist(SHORT_TICKS) / p0).toFixed(1)}× over 5 min and ${(hist(LONG_TICKS) / p0).toFixed(1)}× over 1 h. A human gets out of bed.`);
      }
    }
    if (pagedAt >= 0 && rollbackStart < 0 && t - pagedAt >= HUMAN_TICKS) {
      rollbackStart = t;
      events.push({ tick: t, label: 'rollback', tone: 'warn' });
      notes.push(`${HUMAN_TICKS * TICK_MIN} min after the page, the on-call starts the rollback${strategy === 'bluegreen' ? ' (router flips back to blue)' : ''}.`);
    }

    const phase: Frame['phase'] = rolledBackAt >= 0 ? 'rolled-back' : rollbackStart >= 0 ? 'rolling-back' : pagedAt >= 0 ? 'paged' : doneAt >= 0 ? 'done' : 'deploying';
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    let caption = `${(t + 1) * TICK_MIN} min: ${pct(s)} of traffic on the new version, fleet error rate ${(fleetErr * 100).toFixed(2)}% (burn ${(fleetErr / p0).toFixed(1)}×). ${notes.join(' ')}`;
    if (t === TICKS - 1) {
      const pctBudget = (excess / BUDGET) * 100;
      caption += ` After ${TICKS * TICK_MIN} min: ${Math.round(excess).toLocaleString('en-US')} extra failed requests = ${pctBudget < 0.01 && pctBudget > 0 ? '<0.01' : pctBudget.toFixed(2)}% of the monthly error budget. ${
        E <= p0
          ? strategy === 'canary'
            ? `A good release cost nothing but time: fully out after ${(doneAt + 1) * TICK_MIN} min, versus ~2 min for blue/green and 20 min rolling.`
            : 'A good release: fast and free.'
          : strategy === 'canary'
            ? rollbackStart >= 0
              ? `Caught after ${(rollbackStart + 1) * TICK_MIN} min while ${pct(share[rollbackStart])} of users were exposed — no human involved.`
              : 'The difference was too small for the canary to detect in this window.'
            : pagedAt < 0
              ? `The burn (${(E / p0).toFixed(0)}× at full traffic) is below the ${PAGE_BURN}× page threshold, so nobody was paged in the first hour — only the 6 h / 6× alert or a ticket will catch it.`
              : `Detection needed the 1 h window to fill and a human to react: ${(rollbackStart + 1) * TICK_MIN} min of exposure before the rollback even started.`
      }`;
    }
    let predict: string | undefined;
    if (t === 0 && E > p0) predict = strategy === 'canary' ? 'How many minutes until something notices the new version is worse — and how much traffic will it have seen?' : 'Readiness probes are green. What will stop this rollout, and when?';
    frames.push({ tick: t, share: [...share], err: [...err], excess, events: events.map((e) => ({ ...e })), phase, caption, predict });
  }
  return frames;
}
