// Pure model of an SLO error budget and multi-window, multi-burn-rate alerts (SRE Workbook).
// Uniform traffic, a 0.02 % background error rate, and one incident (error rate E for D minutes)
// starting at minute 60 of a 6-hour view. Each frame advances 10 minutes.
import type { BaseFrame } from '../../core';

export interface Params {
  /** SLO in percent, e.g. 99.9 */
  slo: number;
  /** incident error rate in percent of requests */
  errorPct: number;
  /** incident duration in minutes */
  duration: number;
}

export const VIEW_MIN = 360;
export const STEP_MIN = 10;
export const INCIDENT_AT = 60;
export const BASELINE = 0.0002; // 0.02 % background errors
export const SLO_WINDOW_MIN = 30 * 24 * 60; // 43,200

export interface AlertRule {
  id: string;
  label: string;
  severity: 'page' | 'ticket';
  long: number; // minutes
  short: number; // minutes
  burn: number;
}
export const RULES: AlertRule[] = [
  { id: 'fast', label: 'Page: 1 h & 5 m > 14.4×', severity: 'page', long: 60, short: 5, burn: 14.4 },
  { id: 'slow', label: 'Page: 6 h & 30 m > 6×', severity: 'page', long: 360, short: 30, burn: 6 },
  { id: 'ticket', label: 'Ticket: 3 d & 6 h > 1×', severity: 'ticket', long: 4320, short: 360, burn: 1 },
];
export const WINDOWS = [5, 30, 60, 360, 4320];

/** error ratio in minute m (m < 0 = history before the view, at baseline) */
export function ratioAt(p: Params, m: number): number {
  return m >= INCIDENT_AT && m < INCIDENT_AT + p.duration ? p.errorPct / 100 : BASELINE;
}

/** average bad ratio over the `win` minutes ending at minute t (exclusive) */
export function windowRatio(p: Params, t: number, win: number): number {
  let s = 0;
  for (let m = t - win; m < t; m++) s += ratioAt(p, m);
  return s / win;
}

export const budgetFraction = (slo: number) => 1 - slo / 100;
export const burnRate = (p: Params, t: number, win: number) => windowRatio(p, t, win) / budgetFraction(p.slo);

/** fraction of the 30-day error budget consumed by minutes [0, t) of the view */
export function budgetUsed(p: Params, t: number): number {
  let s = 0;
  for (let m = 0; m < t; m++) s += ratioAt(p, m);
  return s / (budgetFraction(p.slo) * SLO_WINDOW_MIN);
}

export function ruleFiring(p: Params, t: number, r: AlertRule): { long: number; short: number; firing: boolean } {
  const long = burnRate(p, t, r.long);
  const short = burnRate(p, t, r.short);
  return { long, short, firing: long > r.burn && short > r.burn };
}

/** minutes to exhaust the whole 30-day budget at a constant burn rate */
export const minutesToExhaust = (burn: number) => (burn <= 0 ? Infinity : SLO_WINDOW_MIN / burn);

export interface Frame extends BaseFrame {
  t: number;
  burns: Record<number, number>;
  used: number;
  firing: Record<string, boolean>;
  /** would a 1h-only rule (no short window) still be firing? */
  longOnlyFiring: boolean;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const human = (min: number) => (min === Infinity ? 'never' : min >= 2880 ? `${(min / 1440).toFixed(1)} days` : min >= 120 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} min`);

export function simulate(p: Params): Frame[] {
  const frames: Frame[] = [];
  const budget = budgetFraction(p.slo);
  const incBurn = p.errorPct / 100 / budget;
  const end = INCIDENT_AT + p.duration;
  let prev: Record<string, boolean> = {};
  for (let t = 0; ; t = Math.min(VIEW_MIN, t + (t < end + 30 ? STEP_MIN : 30))) {
    const burns: Record<number, number> = {};
    for (const w of WINDOWS) burns[w] = burnRate(p, t, w);
    const firing: Record<string, boolean> = {};
    for (const r of RULES) firing[r.id] = ruleFiring(p, t, r).firing;
    const longOnlyFiring = burns[60] > 14.4;
    const used = budgetUsed(p, t);
    let caption: string;
    let predict: string | undefined;
    const started = RULES.filter((r) => firing[r.id] && !prev[r.id]);
    const cleared = RULES.filter((r) => !firing[r.id] && prev[r.id]);
    if (t === 0) {
      caption = `SLO ${p.slo}% over 30 days → error budget ${pct(budget, 2)} of requests (${human(budget * SLO_WINDOW_MIN)} of full outage). Background errors are ${pct(BASELINE, 2)}: burn rate ${(BASELINE / budget).toFixed(2)}×, comfortably under 1×.`;
    } else if (t === INCIDENT_AT) {
      caption = `Incident starts: ${p.errorPct}% of requests fail. That is a ${incBurn.toFixed(1)}× burn: at this pace the whole 30-day budget is gone in ${human(minutesToExhaust(incBurn))}.`;
      predict = incBurn > 14.4 ? 'The 5-minute window is already above 14.4×. Why does the page not fire yet?' : 'Will the fast-burn page (14.4×) ever fire for this incident?';
    } else if (started.length) {
      caption = `${started.map((r) => r.label).join(' and ')} FIRES at minute ${t}: long window ${burns[started[0].long].toFixed(1)}× and short window ${burns[started[0].short].toFixed(1)}× are both above ${started[0].burn}×. Budget used so far: ${pct(used)}.`;
    } else if (cleared.length) {
      caption = `Fixed at minute ${end}. ${cleared.map((r) => r.label).join(' and ')} resets because its SHORT window (${cleared[0].short} min) dropped to ${burns[cleared[0].short].toFixed(1)}×` + (longOnlyFiring ? `, even though the 1 h average is still ${burns[60].toFixed(1)}×: a 1 h-only alert would keep paging after recovery.` : '.');
    } else if (t === end || (t > end && t - STEP_MIN < end)) {
      caption = `Incident over after ${p.duration} min. It consumed ${pct(used)} of the monthly budget` + (Object.values(firing).some(Boolean) ? '; alerts clear once their short window recovers.' : '.');
    } else if (t >= VIEW_MIN) {
      const any = RULES.filter((r) => frames.some((f) => f.firing[r.id]) || firing[r.id]);
      caption = `Six hours later: ${pct(used)} of the 30-day budget spent. ${any.length ? `Alerts that fired: ${any.map((r) => r.label).join('; ')}.` : 'No alert fired: this incident was too small or too short to be worth a page, which is the point of burn-rate alerting.'} Budget policy: while budget remains, keep shipping.`;
    } else if (t > INCIDENT_AT && t < end) {
      caption = Object.values(firing).some(Boolean)
        ? `Minute ${t}: still paging. 5 m ${burns[5].toFixed(1)}×, 1 h ${burns[60].toFixed(1)}×. Budget used so far: ${pct(used)}.`
        : `Minute ${t}: 5 m ${burns[5].toFixed(1)}×, 1 h ${burns[60].toFixed(1)}×, 6 h ${burns[360].toFixed(1)}×. The short window is hot, but each rule also needs its LONG window over the threshold (1 h > 14.4× or 6 h > 6×), so a brief blip never pages.`;
    } else {
      caption = t < INCIDENT_AT
        ? `Minute ${t}: normal traffic, 5 m burn ${burns[5].toFixed(2)}×. Budget used in this view: ${pct(used, 2)}.`
        : `Minute ${t}: recovered, 5 m burn ${burns[5].toFixed(2)}×, but the 6 h window still remembers the incident (${burns[360].toFixed(1)}×). Budget used: ${pct(used)}.`;
    }
    frames.push({ caption, predict, t, burns, used, firing, longOnlyFiring });
    prev = firing;
    if (t >= VIEW_MIN) break;
  }
  return frames;
}
