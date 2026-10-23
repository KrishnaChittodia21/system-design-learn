// Pure, scripted model of a strangler-fig migration of ONE slice out of a monolith:
// facade → seam → build service + CDC → shadow (diff) → canary 1/10/50/100 % → flip data
// ownership → delete the old code. Choosing a tightly coupled first slice (checkout) shows the
// distributed-monolith cost: sync calls back into the monolith multiply latency and failure.
import type { BaseFrame } from '../../core';

export type Slice = 'pricing' | 'search' | 'checkout';
export const MODULES = ['catalog', 'search', 'pricing', 'checkout', 'notify'] as const;
export type Module = (typeof MODULES)[number];
export const ROUTES: Record<Module, string> = {
  catalog: '/catalog',
  search: '/search',
  pricing: '/pricing',
  checkout: '/checkout',
  notify: '/notify',
};

export interface Params {
  slice: Slice;
  /** the new service has a behaviour difference that shadow traffic will catch */
  bug: boolean;
}

export type ModuleState = 'mono' | 'seam' | 'shared' | 'dual' | 'extracted' | 'deleted';
export type Cdc = 'none' | 'mono-to-svc' | 'svc-to-mono';

export interface SliceInfo {
  /** sync calls the new service must make back into the monolith per request */
  callsBack: number;
  /** tables it touches that other modules also write */
  sharedTables: number;
  why: string;
}
export const SLICES: Record<Slice, SliceInfo> = {
  pricing: { callsBack: 0, sharedTables: 0, why: 'high value (hot path), low coupling, one owning team' },
  search: { callsBack: 0, sharedTables: 0, why: 'read-only, fed entirely by CDC into its own index' },
  checkout: { callsBack: 4, sharedTables: 7, why: 'the transactional heart: it reads cart, stock, price and user, and writes orders' },
};

export const HOP_MS = 25; // one internal sync call (network + serialisation + queueing)
export const MONO_MS = 40; // in-process handler in the monolith
export const SVC_MS = 35;
export const FACADE_MS = 3;
export const PER_CALL_AVAIL = 0.999;
export const DIFF_LIMIT = 0.1; // % of mirrored responses allowed to differ

/** latency and availability of the slice's route when served by the new service */
export function servicePath(slice: Slice): { ms: number; availability: number } {
  const n = SLICES[slice].callsBack;
  return { ms: FACADE_MS + SVC_MS + n * HOP_MS, availability: PER_CALL_AVAIL ** (1 + n) };
}
export function monolithPath(facade: boolean): { ms: number; availability: number } {
  return { ms: MONO_MS + (facade ? FACADE_MS : 0), availability: PER_CALL_AVAIL };
}

export type Phase = 'baseline' | 'facade' | 'seam' | 'build' | 'shadow' | 'fix' | 'canary' | 'flip' | 'delete';

export interface Frame extends BaseFrame {
  phase: Phase;
  facade: boolean;
  /** % of the slice route's traffic served by the new service */
  split: number;
  shadow: boolean;
  diffRate: number | null;
  modules: Record<Module, ModuleState>;
  svcBuilt: boolean;
  cdc: Cdc;
  owner: 'mono' | 'svc';
  /** blended route latency / availability at this split */
  ms: number;
  availability: number;
  blocked: boolean;
}

const pctA = (a: number) => `${(a * 100).toFixed(2)}%`;

export function simulate({ slice, bug }: Params): Frame[] {
  const info = SLICES[slice];
  const frames: Frame[] = [];
  const modules = Object.fromEntries(MODULES.map((m) => [m, 'mono'])) as Record<Module, ModuleState>;
  let facade = false;
  let split = 0;
  let svcBuilt = false;
  let cdc: Cdc = 'none';
  let owner: 'mono' | 'svc' = 'mono';
  const sp = servicePath(slice);
  const push = (phase: Phase, caption: string, extra: Partial<Frame> = {}) => {
    const mp = monolithPath(facade);
    const w = split / 100;
    frames.push({
      caption,
      phase,
      facade,
      split,
      shadow: false,
      diffRate: null,
      modules: { ...modules },
      svcBuilt,
      cdc,
      owner,
      ms: Math.round(mp.ms * (1 - w) + sp.ms * w),
      availability: mp.availability * (1 - w) + sp.availability * w,
      blocked: false,
      ...extra,
    });
  };

  push('baseline', `Today every route is served by one monolith and one database. Goal: move ${ROUTES[slice]} out without a big-bang rewrite. First measure the baseline: ${MONO_MS} ms, ${pctA(PER_CALL_AVAIL)} available.`, {
    predict: `You picked ${slice} as the first slice (${info.why}). Will that make the migration easier or harder?`,
  });

  facade = true;
  push('facade', `Put a facade (gateway / reverse proxy) in front. It routes 100% to the monolith, so nothing changes for users, but from now on moving a route is a config change, not a deploy.`);

  modules[slice] = info.sharedTables ? 'shared' : 'seam';
  push(
    'seam',
    info.sharedTables
      ? `Look for a seam in ${slice}: it touches ${info.sharedTables} tables that catalog, pricing and notify also write. There is no clean module boundary yet, so the new service will have to call back into the monolith.`
      : `Modularise in place: ${slice}'s tables move into their own schema inside the monolith DB and other modules stop reading them directly. That is the seam the service will be cut along.`,
  );

  svcBuilt = true;
  cdc = 'mono-to-svc';
  push(
    'build',
    `Build ${slice}-svc behind an anti-corruption layer that translates the monolith's model. CDC (Debezium) streams the monolith's ${slice} rows into the service's own DB, so the service has data before it owns any writes.` +
      (info.callsBack ? ` It still needs ${info.callsBack} synchronous calls back to the monolith per request.` : ''),
  );

  if (bug) {
    push('shadow', `Shadow launch: the facade mirrors every ${ROUTES[slice]} request to the new service too, discards its answer, and diffs it against the monolith's. 2.40% of responses differ (prices rounded per line instead of per order). Limit is ${DIFF_LIMIT}%: blocked.`, {
      shadow: true,
      diffRate: 2.4,
      blocked: true,
    });
    push('fix', `Fix the ACL to round like the monolith, redeploy, keep mirroring. Users never saw the bug because shadow responses are thrown away.`, { shadow: true, diffRate: 0.03 });
  }
  push('shadow', `Shadow traffic diff rate ${bug ? 'now ' : ''}0.03% < ${DIFF_LIMIT}%: behaviour matches. Safe to let real users see the new service.${slice === 'checkout' ? ' (Mirroring a WRITE path is harder: the shadow must run in dry-run mode so it never reserves stock or charges twice.)' : ''}`, { shadow: true, diffRate: 0.03 });

  for (const s of [1, 10, 50, 100]) {
    split = s;
    modules[slice] = 'dual';
    const extra =
      info.callsBack > 0
        ? ` Each request now makes ${info.callsBack} sync calls back into the monolith: ${sp.ms} ms instead of ${MONO_MS + FACADE_MS} ms, and availability ${pctA(PER_CALL_AVAIL)}^${info.callsBack + 1} = ${pctA(sp.availability)}. Both systems must be up: a distributed monolith.`
        : ` One hop, no callbacks: ${sp.ms} ms vs ${MONO_MS + FACADE_MS} ms, availability unchanged.`;
    push('canary', `Canary ${s}%: the facade sends ${s}% of ${ROUTES[slice]} to ${slice}-svc and watches error rate and latency before the next step.${s === 1 ? extra : s === 100 ? ' All traffic is on the new service; the monolith code is still there as a fallback.' : ''}`);
  }

  owner = 'svc';
  cdc = 'svc-to-mono';
  push('flip', `Flip data ownership: ${slice}-svc becomes the writer. CDC now flows the other way so the monolith's remaining readers keep a copy until they switch to the service API.`);

  modules[slice] = info.callsBack ? 'extracted' : 'deleted';
  push(
    'delete',
    info.callsBack
      ? `Deleting the old ${slice} code is the step teams skip. Here it is worse: the service still depends on ${info.callsBack} monolith endpoints, so every monolith deploy can break checkout. Start with a decoupled slice (pricing, search) and leave the core for last.`
      : `Delete ${slice} from the monolith. Only now is the slice really done: one system, one owner. Repeat for the next route; later slices go faster because the facade, CDC and service template already exist.`,
  );
  return frames;
}
