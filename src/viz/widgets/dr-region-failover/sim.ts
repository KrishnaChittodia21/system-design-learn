// Pure, deterministic timeline of a disaster and the recovery that follows, for three DR tiers.
// RTO is built up from its parts (detect + decide + recover + traffic shift); RPO is whatever was
// written but not yet safe in the recovery copy. Times in seconds from the disaster.
import type { BaseFrame } from '../../core';

export type Strategy = 'backup' | 'passive' | 'active';
export type Disaster = 'region' | 'delete';
export type Approval = 'auto' | 'human';

export interface Params {
  strategy: Strategy;
  disaster: Disaster;
  /** async cross-region replication lag (s) */
  lag: number;
  /** DNS TTL (s) */
  ttl: number;
  approval: Approval;
}

export const STRATEGY_LABELS: Record<Strategy, string> = {
  backup: 'backup & restore',
  passive: 'active-passive (warm standby)',
  active: 'active-active (home regions)',
};
export const DISASTER_LABELS: Record<Disaster, string> = {
  region: 'region outage',
  delete: 'bad DELETE replicated',
};

export const HC_INTERVAL = 10;
export const HC_THRESHOLD = 3;
export const HUMAN_DECISION = 600; // page → on-call → approve: 10 min
export const PROMOTE = 60; // promote replica + scale warm standby
export const PROVISION = 45 * 60; // IaC: stand up the stack in the DR region
export const RESTORE = 60 * 60; // restore ~1 TB snapshot
export const PITR_REPLAY = 20 * 60; // replay archived WAL up to just before the DELETE
export const NOTICE_DELETE = 20 * 60; // health checks stay green; customers/support notice
export const TAIL = 5 * 60; // resolvers ignoring TTL, long-lived connection pools
export const BACKUP_AGE = 15 * 3600; // last nightly backup was 15 h before the disaster
export const WRITES_PER_S = 200;

export type SegKind = 'detect' | 'decide' | 'recover' | 'shift';
export interface Segment {
  kind: SegKind;
  label: string;
  from: number;
  to: number;
}

export interface Frame extends BaseFrame {
  t: number;
  label: string;
  segments: Segment[];
  rpo: number;
  rto: number;
  /** share of users served correctly at time t (0–1) */
  served: number;
  regionA: 'up' | 'down' | 'corrupt' | 'restored';
  regionB: 'standby' | 'serving' | 'none' | 'provisioning' | 'restoring' | 'corrupt';
  dnsTarget: 'A' | 'B' | 'A+B';
  replicationOk: boolean;
  lostWrites: number;
  /** health checks failed so far */
  hcFails: number;
}

export const fmtDur = (s: number): string => {
  if (s < 60) return `${+s.toFixed(1)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};

export function simulate({ strategy, disaster, lag, ttl, approval }: Params): Frame[] {
  const segs: Segment[] = [];
  const frames: Frame[] = [];
  const detectT = disaster === 'region' ? HC_INTERVAL * HC_THRESHOLD : NOTICE_DELETE;
  segs.push({ kind: 'detect', label: disaster === 'region' ? `detect: ${HC_THRESHOLD} failed health checks` : 'detect: support tickets (health checks stay green)', from: 0, to: detectT });

  // decide
  const humanNeeded = strategy === 'backup' || disaster === 'delete' || (strategy === 'passive' && approval === 'human');
  const decideT = detectT + (humanNeeded ? HUMAN_DECISION : 0);
  if (humanNeeded) segs.push({ kind: 'decide', label: disaster === 'delete' ? 'decide: find the bad statement, pick a restore point' : 'decide: page, assess, approve failover', from: detectT, to: decideT });

  // recover
  let recoverT = decideT;
  let recoverLabel = '';
  if (disaster === 'region') {
    if (strategy === 'backup') {
      recoverT = decideT + PROVISION + RESTORE;
      recoverLabel = 'recover: provision stack + restore last backup';
    } else if (strategy === 'passive') {
      recoverT = decideT + PROMOTE;
      recoverLabel = 'recover: promote replica, scale standby';
    }
  } else {
    recoverT = decideT + RESTORE + (strategy === 'backup' ? 0 : PITR_REPLAY);
    recoverLabel = strategy === 'backup' ? 'recover: restore last nightly backup' : 'recover: restore backup + replay WAL to 1 s before the DELETE';
  }
  if (recoverT > decideT) segs.push({ kind: 'recover', label: recoverLabel, from: decideT, to: recoverT });

  // traffic shift (region outage only; a restore in place needs no DNS change)
  let shiftT = recoverT;
  if (disaster === 'region') {
    shiftT = recoverT + ttl;
    segs.push({ kind: 'shift', label: `shift: DNS TTL ${ttl} s (+ a tail that ignores it)`, from: recoverT, to: shiftT });
  }
  const rto = shiftT;
  const rpo = disaster === 'region' ? (strategy === 'backup' ? BACKUP_AGE : lag) : strategy === 'backup' ? BACKUP_AGE : 1;
  const lostWrites = Math.round(rpo * WRITES_PER_S * (strategy === 'active' && disaster === 'region' ? 0.5 : 1));

  const servedAt = (t: number): number => {
    if (t < 0) return 1;
    if (disaster === 'delete') return t >= recoverT ? 1 : 0.6; // site up, but data missing for the affected rows
    if (strategy === 'active') {
      // half the users are homed in the surviving region and never notice
      if (t < recoverT) return 0.5;
      return 0.5 + 0.5 * Math.min(1, (t - recoverT) / Math.max(1, ttl)) * 0.95 + (t >= shiftT + TAIL ? 0.025 : 0);
    }
    if (t < recoverT) return 0;
    return Math.min(1, ttl ? ((t - recoverT) / ttl) * 0.95 : 0.95) + (t >= shiftT + TAIL ? 0.05 : 0);
  };

  const state = (t: number): Pick<Frame, 'regionA' | 'regionB' | 'dnsTarget' | 'replicationOk'> => {
    if (t < 0)
      return {
        regionA: 'up',
        regionB: strategy === 'backup' ? 'none' : strategy === 'active' ? 'serving' : 'standby',
        dnsTarget: strategy === 'active' ? 'A+B' : 'A',
        replicationOk: strategy !== 'backup',
      };
    if (disaster === 'delete')
      return {
        regionA: t >= recoverT ? 'restored' : 'corrupt',
        regionB: strategy === 'backup' ? 'none' : t >= recoverT ? (strategy === 'active' ? 'serving' : 'standby') : 'corrupt',
        dnsTarget: strategy === 'active' ? 'A+B' : 'A',
        replicationOk: strategy !== 'backup',
      };
    const switched = t >= recoverT;
    return {
      regionA: 'down',
      regionB:
        strategy === 'backup'
          ? t < decideT
            ? 'none'
            : t < decideT + PROVISION
              ? 'provisioning'
              : t < recoverT
                ? 'restoring'
                : 'serving'
          : strategy === 'active' || switched
            ? 'serving'
            : 'standby',
      dnsTarget: switched ? 'B' : strategy === 'active' ? 'A+B' : 'A',
      replicationOk: false,
    };
  };

  const push = (t: number, label: string, caption: string, hcFails = 0) =>
    frames.push({ t, label, segments: segs, rpo, rto, served: servedAt(t), ...state(t), lostWrites, hcFails, caption });

  const before =
    strategy === 'backup'
      ? 'Only region A runs. A nightly backup and the IaC templates are copied to region B, but nothing is running there.'
      : strategy === 'passive'
        ? `Region A takes all traffic; region B runs a warm standby at reduced size and replays A's changes asynchronously, ${lag} s behind.`
        : `Both regions serve. Each tenant has a home region for its writes; changes replicate both ways asynchronously, ${lag} s behind.`;
  push(-1, 'steady state', `Steady state, ${STRATEGY_LABELS[strategy]}. ${before} DNS TTL ${ttl} s. ${WRITES_PER_S} writes/s.`);

  if (disaster === 'region') {
    push(
      0,
      'region A fails',
      `t=0: region A goes dark. ${
        strategy === 'backup'
          ? `Everything written since last night's backup (${fmtDur(BACKUP_AGE)} ago) exists only in region A.`
          : `The last ${lag} s of acknowledged writes${strategy === 'active' ? ' homed in A' : ''} had not reached region B yet: that window is the RPO.`
      }${strategy === 'active' ? ' Users homed in B keep working.' : ' Every user now gets errors.'}`,
    );
    for (let k = 1; k <= HC_THRESHOLD; k++) {
      const t = k * HC_INTERVAL;
      push(
        t,
        `health check ${k}/${HC_THRESHOLD} fails`,
        k < HC_THRESHOLD
          ? `t=${t} s: health check ${k} of ${HC_THRESHOLD} fails. One failure could be a blip; requiring ${HC_THRESHOLD} in a row avoids flapping failovers.`
          : `t=${t} s: the ${HC_THRESHOLD}rd consecutive check fails: region A is marked unhealthy. Detection (MTTD) took ${fmtDur(t)}.`,
        k,
      );
    }
  } else {
    push(
      0,
      'DELETE runs',
      `t=0: a migration runs DELETE FROM orders WHERE … with a wrong condition in region A. ${
        strategy === 'backup' ? 'There is no replica to worry about.' : `Within ${lag} s the replica in B applies the same DELETE: replication copies mistakes as faithfully as data.`
      } Every health check stays green.`,
    );
    push(NOTICE_DELETE, 'someone notices', `t=${fmtDur(NOTICE_DELETE)}: support tickets pile up ("my orders are gone"). Nothing alerted, because the system is up; it is just wrong.`);
  }
  if (humanNeeded)
    push(
      decideT,
      'decision made',
      `t=${fmtDur(decideT)}: ${
        disaster === 'delete' ? 'the team finds the bad statement and picks a restore point. Failing over is useless: the other region has the same deletion.' : 'the on-call engineer has been paged, joined the bridge, confirmed it is a real regional outage and approved the failover. People, not machines, are often the slowest part of RTO.'
      }`,
    );
  if (disaster === 'region' && strategy === 'backup') {
    push(decideT + PROVISION, 'stack provisioned', `t=${fmtDur(decideT + PROVISION)}: IaC has created the network, database and app tier in region B; now the restore starts.`);
  }
  if (recoverT > decideT || disaster === 'region')
    push(
      recoverT,
      disaster === 'region' ? (strategy === 'active' ? 'traffic re-routed' : strategy === 'passive' ? 'replica promoted' : 'restore done') : 'restore done',
      disaster === 'region'
        ? strategy === 'active'
          ? `t=${fmtDur(recoverT)}: the global router stops sending anyone to A and re-homes A's tenants to B. No promotion or approval needed, but B must already have the headroom to take 100% of the traffic.`
          : strategy === 'passive'
            ? `t=${fmtDur(recoverT)}: the standby in B is promoted and scaled up, and the DNS failover record now points at B. Clients that still hold the old answer keep calling A until their TTL runs out.`
            : `t=${fmtDur(recoverT)}: the database is restored from last night's backup and DNS is switched to B.`
        : `t=${fmtDur(recoverT)}: the database is restored${strategy === 'backup' ? " from last night's backup: every order since then is gone" : ', and archived WAL is replayed up to one second before the DELETE (point-in-time recovery)'}.`,
    );
  if (disaster === 'region') {
    push(shiftT, 'DNS TTL elapsed', `t=${fmtDur(shiftT)}: the TTL has elapsed, so about 95% of clients now resolve to B. The rest (resolvers that enforce a minimum TTL, pooled keep-alive connections) trickle over in the next ${fmtDur(TAIL)}.`);
  }

  const last = frames[frames.length - 1];
  const rpoNote =
    disaster === 'delete' && strategy !== 'backup'
      ? `≈0 for the deleted rows (restore point 1 s before the DELETE), but the ≈${Math.round(recoverT * WRITES_PER_S).toLocaleString('en-US')} writes made since then must be re-applied onto the restored copy`
      : `≈${lostWrites.toLocaleString('en-US')} writes lost`;
  last.caption += ` Result: RPO ${fmtDur(rpo)} (${rpoNote}), RTO ${fmtDur(rto)}${
    disaster === 'region' ? ` = detect ${fmtDur(detectT)}${humanNeeded ? ` + decide ${fmtDur(HUMAN_DECISION)}` : ''}${recoverT > decideT ? ` + recover ${fmtDur(recoverT - decideT)}` : ''} + DNS ${fmtDur(ttl)}` : ''
  }.`;

  // predictions
  const zero = frames.findIndex((f) => f.t === 0);
  if (zero > 0)
    frames[zero - 1].predict =
      disaster === 'delete'
        ? strategy === 'backup'
          ? 'A bad DELETE is about to run. What will your nightly backup give you back, and what will it not?'
          : `A bad DELETE is about to run in region A. Will the replica in region B save you?`
        : strategy === 'backup'
          ? 'Region A is about to fail. Nothing runs in region B. Roughly how long until users are served again, and how much data is lost?'
          : `Region A is about to fail with replication ${lag} s behind. How much data is lost, and what dominates the time to recover?`;
  return frames;
}
