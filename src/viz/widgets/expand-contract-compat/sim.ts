// Pure model of shipping an API change to three consumers, either in one release ("direct") or as
// expand → migrate → contract. Optional evidence gate: Pact can-i-deploy for first-party consumers
// plus per-client field-usage telemetry for the external partner.
import type { BaseFrame } from '../../core';

export type Change = 'rename' | 'add-field' | 'enum' | 'required';
export type Strategy = 'direct' | 'expand';
export type ClientId = 'web' | 'ios' | 'partner';

export interface Params {
  change: Change;
  strategy: Strategy;
  gate: boolean;
}

export interface ClientInfo {
  id: ClientId;
  name: string;
  /** publishes consumer-driven contracts (Pact) */
  pact: boolean;
  note: string;
}

export const CLIENTS: ClientInfo[] = [
  { id: 'web', name: 'Web app', pact: true, note: 'first-party, deploys daily, tolerant reader' },
  { id: 'ios', name: 'iOS app', pact: true, note: 'first-party, users update slowly, exhaustive enums' },
  { id: 'partner', name: 'Partner CRM', pact: false, note: 'external, strict JSON Schema validation, no pact' },
];

/** share of each client's traffic still on the old contract, by week (after the expand step) */
const OLD_SHARE: Record<ClientId, number[]> = {
  web: [1, 0, 0, 0, 0, 0, 0, 0, 0],
  ios: [1, 0.6, 0.35, 0.2, 0.1, 0.05, 0.03, 0.02, 0.02],
  partner: [1, 1, 1, 1, 0, 0, 0, 0, 0],
};
export const WEEKS = 8;
/** without evidence, the team contracts on a calendar date: right after the 3-week notice period */
export const CALENDAR_CONTRACT = 3;
/** the sunset date published in the Sunset header; after it, old iOS builds get a forced-upgrade screen */
export const SUNSET = 6;

export interface ChangeSpec {
  label: string;
  before: string;
  direct: string;
  expand: string;
  after: string;
  /** what breaks under a direct change, per client (undefined = unaffected) */
  breaks: Partial<Record<ClientId, string>>;
  /** would the client's pact catch it in provider verification? */
  pactCatches: boolean;
  /** why a pact misses it (when pactCatches is false) */
  pactBlind?: string;
  expandHow: string;
}

export const CHANGES: Record<Change, ChangeSpec> = {
  rename: {
    label: 'Rename givenName → firstName',
    before: '{ "givenName": "Ada" }',
    direct: '{ "firstName": "Ada" }',
    expand: '{ "givenName": "Ada", "firstName": "Ada" }',
    after: '{ "firstName": "Ada" }',
    breaks: {
      web: 'profile shows "undefined"',
      ios: 'decoder: key givenName not found',
      partner: 'CRM contacts synced with empty names',
    },
    pactCatches: true,
    expandHow: 'return AND accept both names (givenName marked deprecated)',
  },
  'add-field': {
    label: 'Add response field middleName',
    before: '{ "givenName": "Ada" }',
    direct: '{ "givenName": "Ada", "middleName": "B" }',
    expand: 'middleName only with ?fields=+middleName',
    after: '{ "givenName": "Ada", "middleName": "B" }',
    breaks: { partner: 'additionalProperties: false → payload rejected' },
    pactCatches: false,
    pactBlind: 'the partner has no pact, and even if it had one, Pact ignores response fields a consumer did not ask for',
    expandHow: 'ship the field opt-in first, then make it default',
  },
  enum: {
    label: 'Add enum value status: "paused"',
    before: '{ "status": "active" }',
    direct: '{ "status": "paused" }',
    expand: '"paused" only for API-Version ≥ 2026-11, else "active"',
    after: '{ "status": "paused" }',
    breaks: { ios: 'exhaustive switch: unknown case → crash' },
    pactCatches: false,
    pactBlind: 'the iOS pact only recorded examples with "active"',
    expandHow: 'send the new value only to clients that opt in by version',
  },
  required: {
    label: 'Make request field locale required',
    before: 'POST /users { "givenName": "Ada" } → 201',
    direct: 'POST without locale → 422',
    expand: 'locale optional, default "en-US", missing ones logged',
    after: 'locale required',
    breaks: {
      web: 'sign-up form gets 422',
      ios: 'sign-up fails with 422',
      partner: 'bulk import rejected (422)',
    },
    pactCatches: true,
    expandHow: 'accept it as optional with a server default, log who omits it',
  },
};

export type ClientState = 'ok' | 'broken' | 'blocked' | 'migrating' | 'migrated' | 'upgrade-prompt';

export interface ClientView {
  id: ClientId;
  state: ClientState;
  /** share of its traffic still on the old contract (0..1), null when the change does not affect it */
  oldShare: number | null;
  detail: string;
  /** Pact verification result for this step, if run */
  pact: 'pass' | 'fail' | 'blind' | null;
}

export interface Frame extends BaseFrame {
  week: number;
  stage: 'start' | 'ci' | 'deploy' | 'expand' | 'migrate' | 'contract' | 'blocked' | 'end';
  server: string;
  clients: ClientView[];
  gateMsg: string | null;
  gateOk: boolean | null;
  /** users/requests hit by a break so far (rough, for the summary) */
  incidents: number;
  timeline: { week: number; label: string; tone: 'ok' | 'bad' | 'warn' }[];
}

export function simulate({ change, strategy, gate }: Params): Frame[] {
  const spec = CHANGES[change];
  const affected = CLIENTS.filter((c) => spec.breaks[c.id]);
  const frames: Frame[] = [];
  const timeline: Frame['timeline'] = [];
  let incidents = 0;
  const view = (fn: (c: ClientInfo) => Omit<ClientView, 'id'>): ClientView[] => CLIENTS.map((c) => ({ id: c.id, ...fn(c) }));
  const idle = (c: ClientInfo): Omit<ClientView, 'id'> => ({
    state: 'ok',
    oldShare: spec.breaks[c.id] ? 1 : null,
    detail: spec.breaks[c.id] ? 'relies on the old contract' : 'unaffected',
    pact: null,
  });
  const push = (f: Omit<Frame, 'timeline' | 'incidents'>) => frames.push({ ...f, incidents, timeline: timeline.map((t) => ({ ...t })) });

  push({
    week: 0,
    stage: 'start',
    server: spec.before,
    clients: view(idle),
    gateMsg: null,
    gateOk: null,
    caption: `Change: ${spec.label}. Three consumers run in production right now; ${affected.length ? `${affected.map((c) => c.name).join(', ')} depend${affected.length === 1 ? 's' : ''} on today's behaviour` : 'none depends on it'}. ${
      strategy === 'direct' ? 'Plan: ship it in one release.' : `Plan: expand (${spec.expandHow}), migrate, then contract.`
    }`,
  });

  // provider verification against first-party pacts
  const pactRun = (c: ClientInfo, breaking: boolean): ClientView['pact'] => (!c.pact ? null : breaking && !spec.pactCatches ? 'blind' : breaking ? 'fail' : 'pass');

  if (strategy === 'direct') {
    if (gate) {
      const results = view((c) => {
        const br = !!spec.breaks[c.id];
        const p = pactRun(c, br);
        return { ...idle(c), pact: p, state: p === 'fail' ? 'blocked' : 'ok', detail: p === 'fail' ? `pact fails: ${spec.breaks[c.id]}` : p === 'blind' ? 'pact passes — it never asserted this' : c.pact ? 'pact passes' : 'no pact (external)' };
      });
      const failing = results.filter((r) => r.pact === 'fail');
      if (failing.length) {
        timeline.push({ week: 0, label: 'CI ✗', tone: 'ok' });
        push({
          week: 0,
          stage: 'blocked',
          server: spec.before,
          clients: results,
          gateMsg: `can-i-deploy: NO — ${failing.map((r) => CLIENTS.find((c) => c.id === r.id)!.name).join(', ')} pact verification failed`,
          gateOk: false,
          caption: `CI replays every consumer's recorded interactions against the new provider build. ${failing.map((r) => CLIENTS.find((c) => c.id === r.id)!.name).join(' and ')} fail, so can-i-deploy blocks the release before a single user sees it.${
            spec.breaks.partner ? ' The partner has no pact — only an OpenAPI diff (oasdiff) would flag it.' : ''
          }`,
          predict: 'The change is still needed. How do you ship it without breaking anyone?',
        });
        push({
          week: 0,
          stage: 'end',
          server: spec.before,
          clients: results,
          gateMsg: 'blocked — switch the plan to expand → contract',
          gateOk: false,
          caption: `Nothing broke because nothing shipped. The fix is not to delete the failing pact but to change the plan: switch to "Expand → contract" to see the same change land with zero breakage.`,
        });
        return frames;
      }
      push({
        week: 0,
        stage: 'ci',
        server: spec.before,
        clients: results,
        gateMsg: 'can-i-deploy: YES — all pacts verified',
        gateOk: true,
        caption: `CI verifies the web and iOS pacts: all green. ${
          affected.length
            ? `But a pact only checks what the consumer wrote down — ${spec.pactBlind ?? 'the partner has no pact'} — so ${affected.map((c) => c.name).join(' and ')} ${affected.length === 1 ? 'is' : 'are'} not protected. Contract tests are not proof of compatibility.`
            : ''
        }`,
        predict: affected.length ? `The release goes out. What happens to ${affected.map((c) => c.name).join(' and ')}?` : undefined,
      });
    }
    timeline.push({ week: 0, label: 'deploy', tone: affected.length ? 'bad' : 'ok' });
    incidents += affected.length;
    push({
      week: 0,
      stage: 'deploy',
      server: spec.direct,
      clients: view((c) =>
        spec.breaks[c.id]
          ? { state: 'broken', oldShare: 1, detail: spec.breaks[c.id]!, pact: null }
          : { state: 'ok', oldShare: null, detail: 'tolerant: unaffected', pact: null },
      ),
      gateMsg: gate ? 'shipped (pacts were green)' : null,
      gateOk: gate ? true : null,
      caption: affected.length
        ? `Deployed. ${affected.map((c) => `${c.name}: ${spec.breaks[c.id]}`).join('; ')}. None of these clients did anything wrong — the server broke its promise. Rolling back now races against data already written.`
        : 'Deployed and nobody breaks: this change is backward compatible for every consumer.',
    });
    push({
      week: 0,
      stage: 'end',
      server: spec.direct,
      clients: frames[frames.length - 1].clients,
      gateMsg: frames[frames.length - 1].gateMsg,
      gateOk: frames[frames.length - 1].gateOk,
      caption: affected.length
        ? `Result: ${affected.length} consumer${affected.length > 1 ? 's' : ''} broken in production. ${
            change === 'add-field' ? 'Even a purely additive field breaks a strict validator (Hyrum’s law) — tolerant readers make additions safe. ' : ''
          }${change === 'enum' ? 'A new enum value is only safe if every client has a default branch. ' : ''}Try "Expand → contract".`
        : 'Result: safe. Additive, tolerant changes need no migration plan.',
    });
    return frames;
  }

  // ---- expand → migrate → contract
  timeline.push({ week: 0, label: 'expand', tone: 'ok' });
  push({
    week: 0,
    stage: 'expand',
    server: spec.expand,
    clients: view((c) => {
      const p = gate ? pactRun(c, false) : null;
      return { ...idle(c), pact: p, detail: spec.breaks[c.id] ? 'still on the old contract — works' : 'unaffected' };
    }),
    gateMsg: gate ? 'can-i-deploy: YES — expand is purely additive' : null,
    gateOk: gate ? true : null,
    caption: `Week 0 — EXPAND: ${spec.expandHow}. Old and new representations coexist, so every consumer keeps working${gate ? ' and every pact still verifies' : ''}. Responses carry Deprecation and Sunset (week ${SUNSET}) headers.`,
  });

  let contracted = -1;
  for (let w = 1; w <= WEEKS; w++) {
    const share = (id: ClientId) => (spec.breaks[id] ? OLD_SHARE[id][w] : null);
    const stillOld = affected.filter((c) => (share(c.id) ?? 0) > 0);
    const sunsetPassed = w >= SUNSET;
    // with evidence: contract only once nobody is on the old contract, except a long tail cut off by the published sunset
    const canContract = gate ? stillOld.every((c) => c.id === 'ios' && sunsetPassed) : w >= CALENDAR_CONTRACT;
    if (contracted < 0 && canContract) {
      contracted = w;
      const hurt = stillOld.filter((c) => !(c.id === 'ios' && sunsetPassed));
      incidents += hurt.length;
      timeline.push({ week: w, label: 'contract', tone: hurt.length ? 'bad' : 'ok' });
      push({
        week: w,
        stage: 'contract',
        server: spec.after,
        clients: view((c) => {
          const s = share(c.id);
          if (s === null) return { state: 'ok', oldShare: null, detail: 'unaffected', pact: gate && c.pact ? 'pass' : null };
          if (s === 0) return { state: 'migrated', oldShare: 0, detail: 'on the new contract', pact: gate && c.pact ? 'pass' : null };
          if (c.id === 'ios' && sunsetPassed)
            return { state: 'upgrade-prompt', oldShare: s, detail: `${Math.round(s * 100)}% on retired builds see "please update"`, pact: gate ? 'pass' : null };
          return { state: 'broken', oldShare: s, detail: `${Math.round(s * 100)}% still old: ${spec.breaks[c.id]}`, pact: null };
        }),
        gateMsg: gate
          ? `can-i-deploy: YES — no deployed consumer version uses the old contract${stillOld.length ? ' (old iOS builds marked unsupported at sunset)' : ''}`
          : null,
        gateOk: gate ? true : null,
        caption: gate
          ? `Week ${w} — CONTRACT on evidence: ${[
              spec.breaks.partner ? 'field-usage telemetry shows the partner at 0%' : '',
              spec.breaks.web || spec.breaks.ios ? 'can-i-deploy passes against every consumer version still supported' : '',
            ]
              .filter(Boolean)
              .join(' and ')}. ${
              stillOld.length ? `The last ${Math.round((share('ios') ?? 0) * 100)}% on retired iOS builds get a forced-upgrade screen, not a crash.` : 'Nobody is left on the old contract.'
            }`
          : `Week ${w} — CONTRACT by the calendar ("the notice period is over"). ${
              hurt.length ? `But ${hurt.map((c) => `${c.name} (${Math.round((share(c.id) ?? 0) * 100)}% still old)`).join(' and ')} had not finished migrating — they break now.` : 'Luckily everyone had already migrated.'
            }`,
      });
      continue;
    }
    if (contracted >= 0 && w > contracted + 1) break;
    push({
      week: w,
      stage: contracted >= 0 ? 'end' : 'migrate',
      server: contracted >= 0 ? spec.after : spec.expand,
      clients: view((c) => {
        const s = share(c.id);
        if (s === null) return { state: 'ok', oldShare: null, detail: 'unaffected', pact: null };
        if (contracted >= 0) {
          const prev = frames[frames.length - 1].clients.find((x) => x.id === c.id)!;
          return { ...prev, oldShare: prev.state === 'broken' || prev.state === 'upgrade-prompt' ? s : 0, pact: null };
        }
        return { state: s === 0 ? 'migrated' : 'migrating', oldShare: s, detail: s === 0 ? 'migrated' : `${Math.round(s * 100)}% of traffic still old`, pact: null };
      }),
      gateMsg: contracted >= 0 ? null : gate ? `can-i-deploy (contract): NO — ${stillOld.map((c) => c.name).join(', ')} still on the old contract` : null,
      gateOk: contracted >= 0 || !gate ? null : false,
      caption:
        contracted >= 0
          ? `Week ${w}: done. ${incidents ? `${incidents} consumer${incidents > 1 ? 's' : ''} broke because the contract step ran on hope instead of evidence.` : 'Zero consumers broke: each step was separately deployable and reversible, and the contract step waited for evidence.'}`
          : `Week ${w} — MIGRATE: ${affected
              .map((c) => `${c.name} ${Math.round((share(c.id) ?? 0) * 100)}% old`)
              .join(', ')}. ${w === 1 ? affected.map((c) => (c.id === 'web' ? 'the web app ships the switch in a day' : c.id === 'ios' ? 'app-store adoption is a long tail' : 'the partner waits for its own release cycle')).join('; ').replace(/^./, (x) => x.toUpperCase()) + '.' : stillOld.length ? 'Usage telemetry per client ID tells you who is still on the old contract.' : 'Everyone has moved.'}`,
      predict:
        contracted < 0 && !gate && w === CALENDAR_CONTRACT - 1 && affected.length
          ? `The ${CALENDAR_CONTRACT}-week notice period ends next week and the team plans to contract then. Is everyone off the old contract?`
          : undefined,
    });
  }
  if (frames[frames.length - 1].stage !== 'end') {
    const last = frames[frames.length - 1];
    push({
      ...last,
      stage: 'end',
      caption: `Done at week ${last.week}. ${incidents ? `${incidents} consumer${incidents > 1 ? 's' : ''} broke because the contract step ran on hope instead of evidence.` : 'Zero consumers broke.'}`,
      predict: undefined,
    });
  }
  return frames;
}
