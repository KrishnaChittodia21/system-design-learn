// Pure, deterministic model of ONE checkout request traced across five services.
// The span tree (with start/end times) is built per scenario; frames replay span start/end
// events on a timeline, then compute the critical path and per-span self time to find the culprit,
// and finally show the RED metrics and log lines the request emitted (joined by trace_id).
import type { BaseFrame } from '../../core';

export type Scenario = 'healthy' | 'slow-db' | 'retries';

export interface Params {
  scenario: Scenario;
  /** checkout forgets to forward traceparent to pricing → pricing's spans land in an orphan trace */
  broken: boolean;
}

export type Kind = 'SERVER' | 'CLIENT' | 'INTERNAL';

export interface Span {
  id: string;
  parent: string | null;
  service: string;
  name: string;
  kind: Kind;
  start: number;
  end: number;
  error: boolean;
  /** which trace the span ended up in */
  trace: 'main' | 'orphan';
}

export const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
export const ORPHAN_ID = '9a1c07d2e8f14b6c8d0e2f3a4b5c6d7e';
export const SERVICES = ['gateway', 'checkout', 'inventory', 'pricing', 'payment'] as const;

/** Build the span tree. Times in ms from the request's arrival at the gateway. */
export function buildSpans({ scenario, broken }: Params): Span[] {
  const s: Span[] = [];
  const add = (id: string, parent: string | null, service: string, name: string, kind: Kind, start: number, end: number, error = false) =>
    s.push({ id, parent, service, name, kind, start, end, error, trace: 'main' });

  // fan-out: inventory ∥ pricing, then payment
  const invEnd = 70;
  add('inv', 'chk', 'inventory', 'GET /stock', 'SERVER', 14, invEnd);
  add('invdb', 'inv', 'inventory', 'SELECT stock', 'CLIENT', 22, 62);

  let priceEnd: number;
  if (scenario === 'retries') {
    // pricing's cache call times out twice (200 ms timeout) before succeeding
    add('pr', 'chk', 'pricing', 'GET /quote', 'SERVER', 14, 0);
    add('prc1', 'pr', 'pricing', 'redis GET (try 1)', 'CLIENT', 20, 220, true);
    add('prc2', 'pr', 'pricing', 'redis GET (try 2)', 'CLIENT', 230, 430, true);
    add('prc3', 'pr', 'pricing', 'redis GET (try 3)', 'CLIENT', 440, 452);
    priceEnd = 462;
  } else {
    add('pr', 'chk', 'pricing', 'GET /quote', 'SERVER', 14, 0);
    add('prc1', 'pr', 'pricing', 'redis GET', 'CLIENT', 20, 32);
    priceEnd = 44;
  }
  s.find((x) => x.id === 'pr')!.end = priceEnd;

  const payStart = Math.max(invEnd, priceEnd) + 6;
  const dbDur = scenario === 'slow-db' ? 880 : 28;
  add('pay', 'chk', 'payment', 'POST /charge', 'SERVER', payStart, 0);
  add('paydb', 'pay', 'payment', 'INSERT payment', 'CLIENT', payStart + 6, payStart + 6 + dbDur);
  const pspStart = payStart + 6 + dbDur + 4;
  add('psp', 'pay', 'payment', 'PSP authorize', 'CLIENT', pspStart, pspStart + 120);
  const payEnd = pspStart + 126;
  s.find((x) => x.id === 'pay')!.end = payEnd;

  const chkEnd = payEnd + 8;
  s.unshift({ id: 'chk', parent: 'gw', service: 'checkout', name: 'POST /checkout', kind: 'SERVER', start: 6, end: chkEnd, error: false, trace: 'main' });
  s.unshift({ id: 'gw', parent: null, service: 'gateway', name: 'POST /api/checkout', kind: 'SERVER', start: 0, end: chkEnd + 6, error: false, trace: 'main' });

  if (broken) {
    // no traceparent on the checkout → pricing hop: pricing starts a NEW root trace
    for (const x of s) if (x.id === 'pr' || x.parent === 'pr') x.trace = 'orphan';
    s.find((x) => x.id === 'pr')!.parent = null;
  }
  return s;
}

/** Critical path: from the root, repeatedly follow the child that finishes last (and its
 *  predecessors that end before it starts). Returns span ids on the path and each one's self
 *  time on the path (duration not covered by critical children). */
export function criticalPath(spans: Span[]): { path: string[]; self: Record<string, number> } {
  const byParent = new Map<string, Span[]>();
  for (const x of spans) if (x.parent) byParent.set(x.parent, [...(byParent.get(x.parent) ?? []), x]);
  const path: string[] = [];
  const self: Record<string, number> = {};
  const walk = (sp: Span) => {
    path.push(sp.id);
    const kids = (byParent.get(sp.id) ?? []).filter((k) => k.trace === sp.trace);
    let cursor = sp.end;
    let covered = 0;
    // walk backwards: pick the child ending last before cursor, then continue before its start
    for (;;) {
      const cand = kids.filter((k) => k.end <= cursor).sort((a, b) => b.end - a.end)[0];
      if (!cand) break;
      covered += cand.end - cand.start;
      walk(cand);
      cursor = cand.start;
    }
    self[sp.id] = sp.end - sp.start - covered;
  };
  const root = spans.find((x) => x.parent === null && x.trace === 'main');
  if (root) walk(root);
  return { path, self };
}

export type Phase = 'run' | 'critical' | 'culprit' | 'signals';

export interface LogLine {
  service: string;
  trace: string;
  span: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  ms: number;
}

export interface Frame extends BaseFrame {
  phase: Phase;
  /** timeline cursor (ms) */
  t: number;
  /** spans visible (started) and whether finished */
  started: string[];
  finished: string[];
  critical: string[];
  self: Record<string, number>;
  /** span ids with (near-)largest self time on the critical path */
  culprit: string[];
  logs: LogLine[];
}

const spanHex = (id: string) => {
  let h = 0x9e3779b1;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b) >>> 0;
  return (h.toString(16).padStart(8, '0') + ((h * 7) >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
};
export const spanIdHex = spanHex;

export function logsFor(spans: Span[]): LogLine[] {
  return spans
    .filter((x) => x.kind === 'SERVER' || x.error)
    .sort((a, b) => a.end - b.end)
    .map((x) => ({
      service: x.service,
      trace: x.trace === 'main' ? TRACE_ID : ORPHAN_ID,
      span: spanHex(x.id),
      level: x.error ? 'warn' : 'info',
      msg: x.error ? `${x.name} timed out after ${x.end - x.start} ms, retrying` : `${x.name} 200`,
      ms: x.end - x.start,
    }));
}

export function simulate(params: Params): Frame[] {
  const spans = buildSpans(params);
  const frames: Frame[] = [];
  const events = spans
    .flatMap((x) => [
      { t: x.start, type: 'start' as const, x },
      { t: x.end, type: 'end' as const, x },
    ])
    .sort((a, b) => a.t - b.t || (a.type === 'end' ? -1 : 1));
  const started: string[] = [];
  const finished: string[] = [];
  const base = { critical: [] as string[], self: {} as Record<string, number>, culprit: [] as string[], logs: [] as LogLine[] };
  const total = spans.find((x) => x.id === 'gw')!.end;

  frames.push({
    ...base,
    phase: 'run',
    t: 0,
    started: [],
    finished: [],
    caption: `A shopper hits POST /api/checkout. The gateway starts trace ${TRACE_ID.slice(0, 8)}… and sends traceparent: 00-${TRACE_ID.slice(0, 8)}…-<span-id>-01 on every outgoing call, so each service's spans join the same tree.`,
    predict: params.scenario === 'healthy' ? undefined : 'Every service will report "my handler is fine" on its own dashboard. Where will the time actually go?',
  });

  // group events in the same ms into one frame; collapse noisy pairs to keep ~12 frames
  let k = 0;
  while (k < events.length) {
    const t = events[k].t;
    const batch = [];
    while (k < events.length && events[k].t === t) batch.push(events[k++]);
    for (const e of batch) {
      if (e.type === 'start') started.push(e.x.id);
      else finished.push(e.x.id);
    }
    const starts = batch.filter((e) => e.type === 'start').map((e) => e.x);
    const ends = batch.filter((e) => e.type === 'end').map((e) => e.x);
    const describe = (x: Span) => `${x.service} ${x.kind} "${x.name}"`;
    let caption = `t = ${t} ms. `;
    if (starts.length) caption += `Started: ${starts.map(describe).join('; ')}. `;
    if (ends.length) caption += `Finished: ${ends.map((x) => `${describe(x)} (${x.end - x.start} ms${x.error ? ', ERROR timeout' : ''})`).join('; ')}. `;
    if (starts.some((x) => x.id === 'inv') && starts.some((x) => x.id === 'pr')) {
      caption += params.broken
        ? 'Checkout calls inventory and pricing in parallel, but it forgot to forward traceparent to pricing: pricing starts a brand-new trace.'
        : 'Checkout fans out to inventory and pricing in parallel: overlapping bars.';
    }
    if (ends.some((x) => x.id === 'prc1') && params.scenario === 'retries') caption += 'Repeated sibling CLIENT spans are the signature of retries.';
    frames.push({ ...base, phase: 'run', t, started: [...started], finished: [...finished], caption: caption.trim() });
  }

  const { path, self } = criticalPath(spans);
  frames.push({
    ...base,
    phase: 'critical',
    t: total,
    started: [...started],
    finished: [...finished],
    critical: path,
    self,
    caption: `End-to-end ${total} ms. Critical path (bold): ${path
      .map((id) => spans.find((x) => x.id === id)!)
      .sort((a, b) => a.start - b.start)
      .map((x) => `${x.service}:${x.name}`)
      .join(' → ')}. Spans off this path (the faster parallel branch) could be twice as slow without changing the user's latency.`,
  });

  const ranked = path.map((id) => ({ id, self: self[id] })).sort((a, b) => b.self - a.self);
  const top = ranked[0].self;
  const culprit = ranked.filter((r) => r.self >= top * 0.8).map((r) => r.id);
  const cs = spans.find((x) => x.id === culprit[0])!;
  const gw = spans.find((x) => x.id === 'gw')!;
  const culpritSelf = culprit.reduce((n, id) => n + self[id], 0);
  let why: string;
  if (params.broken && cs.id === 'chk') {
    why = `It looks like checkout itself burns ${self.chk} ms, but that is an unexplained gap: checkout was waiting on pricing, whose spans are in another trace. Broken propagation makes the wrong service look guilty.`;
  } else if (params.scenario === 'slow-db') {
    why = 'A slow INSERT on payment-db: next stop is that database’s USE metrics (lock waits, IOPS, connection pool).';
  } else if (params.scenario === 'retries') {
    why = `pricing's handler is fine: ${culprit.length} Redis calls timed out at 200 ms each and were retried. Retries hide inside a service's latency; fix the cache or the timeout, not pricing's code.`;
  } else {
    why = 'Healthy request: no single hop dominates; the external PSP call is the largest, as expected.';
  }
  frames.push({
    ...base,
    phase: 'culprit',
    t: total,
    started: [...started],
    finished: [...finished],
    critical: path,
    self,
    culprit,
    caption: `Rank by SELF time on the critical path, not total time (the gateway's total is always the full ${gw.end - gw.start} ms). Largest: ${culprit
      .map((id) => {
        const x = spans.find((y) => y.id === id)!;
        return `${x.service} "${x.name}"`;
      })
      .join(', ')} = ${culpritSelf} ms of ${total} ms. ${why}`,
  });

  const logs = logsFor(spans);
  const errs = spans.filter((x) => x.error && x.trace === 'main').length;
  frames.push({
    ...base,
    phase: 'signals',
    t: total,
    started: [...started],
    finished: [...finished],
    critical: path,
    self,
    culprit,
    logs,
    caption:
      `The same request also produced RED metrics (Rate +1, Errors ${errs ? `+0 user-visible but ${errs} internal timeouts` : '+0'}, Duration ${total} ms into the histogram) and log lines. ` +
      (params.broken
        ? `Because pricing never received traceparent, its logs carry trace_id ${ORPHAN_ID.slice(0, 8)}…: searching logs by the checkout's trace_id misses them. Forward the headers (or let OTel auto-instrumentation do it).`
        : `Every log line carries trace_id ${TRACE_ID.slice(0, 8)}…, so one click jumps from the slow span to its logs.`),
  });
  return frames;
}
