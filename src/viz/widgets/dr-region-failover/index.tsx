import { Fragment, useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DISASTER_LABELS, STRATEGY_LABELS, fmtDur, simulate, type Approval, type Disaster, type Frame, type Params, type SegKind, type Strategy } from './sim';

const SEG_COLOR: Record<SegKind, string> = { detect: 'var(--amber)', decide: 'var(--mag)', recover: 'var(--blue)', shift: 'var(--green)' };
const SEG_SOFT: Record<SegKind, string> = { detect: 'var(--amber-s)', decide: 'var(--mag-s)', recover: 'var(--blue-s)', shift: 'var(--green-s)' };
const SEG_NAME: Record<SegKind, string> = { detect: 'detect', decide: 'decide', recover: 'recover', shift: 'DNS shift' };
const TTLS = [0, 30, 60, 300, 3600];

const REGION_STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  up: { fill: 'var(--good-soft)', stroke: 'var(--good)', text: 'serving' },
  serving: { fill: 'var(--good-soft)', stroke: 'var(--good)', text: 'serving' },
  standby: { fill: 'var(--surface)', stroke: 'var(--border-strong)', text: 'warm standby' },
  none: { fill: 'none', stroke: 'var(--border-strong)', text: 'nothing running' },
  provisioning: { fill: 'var(--blue-s)', stroke: 'var(--blue)', text: 'provisioning…' },
  restoring: { fill: 'var(--blue-s)', stroke: 'var(--blue)', text: 'restoring backup…' },
  down: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', text: 'DOWN' },
  corrupt: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', text: 'up, rows deleted' },
  restored: { fill: 'var(--good-soft)', stroke: 'var(--good)', text: 'restored' },
};

const BAR_X = 8;
const BAR_W = 584;

function layout(f: Frame) {
  const total = f.segments.reduce((a, s) => a + (s.to - s.from), 0) || 1;
  const minW = 64;
  const raw = f.segments.map((s) => ((s.to - s.from) / total) * BAR_W);
  const small = raw.filter((w) => w < minW).length;
  const bigSum = raw.filter((w) => w >= minW).reduce((a, w) => a + w, 0) || 1;
  const spare = BAR_W - small * minW;
  const widths = raw.map((w) => (w < minW ? minW : (w / bigSum) * spare));
  let x = BAR_X;
  const segs = f.segments.map((s, k) => {
    const out = { ...s, x, w: widths[k] };
    x += widths[k];
    return out;
  });
  const xAt = (t: number) => {
    if (t < 0) return BAR_X;
    for (const s of segs) if (t <= s.to) return s.x + ((t - s.from) / Math.max(1e-9, s.to - s.from)) * s.w;
    return BAR_X + BAR_W;
  };
  return { segs, xAt };
}

export default function DrRegionFailoverViz() {
  const [params, setParams] = useState<Params>({ strategy: 'passive', disaster: 'region', lag: 2, ttl: 60, approval: 'human' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { segs, xAt } = layout(f);
  const A = REGION_STYLE[f.regionA];
  const B = REGION_STYLE[f.regionB];
  const toA = f.dnsTarget !== 'B';
  const toB = f.dnsTarget !== 'A';
  const ttlIndex = Math.max(0, TTLS.indexOf(params.ttl));
  const served = Math.round(f.served * 100);
  const done = stepper.i === stepper.total - 1;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="DR tier"
            value={params.strategy}
            options={(Object.keys(STRATEGY_LABELS) as Strategy[]).map((k) => ({ value: k, label: STRATEGY_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, strategy: v }))}
          />
          <Choice<Disaster>
            label="Disaster"
            value={params.disaster}
            options={(Object.keys(DISASTER_LABELS) as Disaster[]).map((k) => ({ value: k, label: DISASTER_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, disaster: v }))}
          />
          {params.strategy === 'passive' && params.disaster === 'region' && (
            <Choice<Approval>
              label="Failover"
              value={params.approval}
              options={[
                { value: 'auto', label: 'automatic' },
                { value: 'human', label: 'human-approved' },
              ]}
              onChange={(v) => setParams((p) => ({ ...p, approval: v }))}
            />
          )}
          {params.strategy !== 'backup' && (
            <Slider label="Replication lag" value={params.lag} min={0} max={30} onChange={(v) => setParams((p) => ({ ...p, lag: v }))} format={(v) => `${v} s`} />
          )}
          {params.disaster === 'region' && (
            <Slider label="DNS TTL" value={ttlIndex} min={0} max={TTLS.length - 1} onChange={(v) => setParams((p) => ({ ...p, ttl: TTLS[v] }))} format={(v) => fmtDur(TTLS[v])} />
          )}
        </>
      }
      legend={
        <>
          {(['detect', 'decide', 'recover', 'shift'] as SegKind[]).map((k) => (
            <Fragment key={k}>
              <span className="viz-key" style={{ background: SEG_COLOR[k] }} /> {SEG_NAME[k]}
            </Fragment>
          ))}
          <span>bar widths are not to scale; durations are</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 292"
        className="viz-svg"
        role="img"
        aria-label={`${f.label}. Region A ${A.text}, region B ${B.text}. DNS points to ${f.dnsTarget}. ${served}% of users served. RPO ${fmtDur(f.rpo)}, RTO ${fmtDur(f.rto)}.`}
      >
        <defs>
          <marker id="dr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        <text x={8} y={16} className="viz-label">
          {f.t < 0 ? 'before the disaster' : `t = ${fmtDur(f.t)} after the disaster`}
        </text>
        <text x={592} y={16} textAnchor="end" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--text-2)' }}>
          {f.label}
        </text>

        {/* users */}
        <rect x={8} y={50} width={96} height={62} rx={10} fill="var(--surface)" stroke="var(--border-strong)" />
        <text x={56} y={74} textAnchor="middle" className="viz-node-label">
          users
        </text>
        <text x={56} y={96} textAnchor="middle" style={{ fontSize: 12, fontWeight: 800, fill: served >= 95 ? 'var(--good)' : served > 0 ? 'var(--warn)' : 'var(--bad)' }}>
          {served}% served
        </text>
        <line x1={104} y1={81} x2={128} y2={81} stroke="var(--muted)" markerEnd="url(#dr-arrow)" />

        {/* DNS */}
        <rect x={130} y={54} width={112} height={54} rx={10} fill="var(--surface)" stroke="var(--border-strong)" />
        <text x={186} y={74} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700 }}>
          DNS / router
        </text>
        <text x={186} y={94} textAnchor="middle" className="viz-label" style={{ fontSize: 11 }}>
          → {f.dnsTarget} · TTL {fmtDur(params.ttl)}
        </text>
        <line x1={242} y1={72} x2={286} y2={50} stroke={toA ? (f.regionA === 'down' ? 'var(--bad)' : 'var(--text-2)') : 'var(--border)'} strokeWidth={toA ? 2.2 : 1} strokeDasharray={toA ? undefined : '4 4'} markerEnd="url(#dr-arrow)" />
        <line x1={242} y1={92} x2={286} y2={120} stroke={toB ? 'var(--text-2)' : 'var(--border)'} strokeWidth={toB ? 2.2 : 1} strokeDasharray={toB ? undefined : '4 4'} markerEnd="url(#dr-arrow)" />

        {/* regions */}
        {[
          { id: 'A', y: 26, s: A },
          { id: 'B', y: 96, s: B },
        ].map((r) => (
          <g key={r.id}>
            <rect x={290} y={r.y} width={150} height={50} rx={10} fill={r.s.fill} stroke={r.s.stroke} strokeWidth={2} strokeDasharray={r.s === REGION_STYLE.none ? '5 4' : undefined} />
            <text x={300} y={r.y + 20} style={{ fontSize: 12.5, fontWeight: 800 }}>
              region {r.id}
            </text>
            <text x={300} y={r.y + 38} style={{ fontSize: 11.5, fontWeight: 700, fill: r.s.stroke }}>
              {r.s.text}
            </text>
          </g>
        ))}
        {/* replication */}
        <line x1={365} y1={77} x2={365} y2={94} stroke={params.strategy === 'backup' ? 'var(--border)' : f.replicationOk ? 'var(--blue)' : 'var(--bad)'} strokeWidth={2} strokeDasharray={params.strategy === 'backup' ? '3 3' : undefined} markerEnd="url(#dr-arrow)" />
        <text x={372} y={90} style={{ fontSize: 10, fill: 'var(--muted)' }}>
          {params.strategy === 'backup' ? 'nightly backup copy' : `async · lag ${params.lag} s${params.strategy === 'active' ? ' (both ways)' : ''}`}
        </text>

        {/* RPO / RTO panel */}
        <rect x={454} y={26} width={138} height={120} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <text x={464} y={46} className="viz-label">
          RPO (data loss)
        </text>
        <text x={464} y={66} style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--f-mono)', fill: f.t >= 0 ? 'var(--warn)' : 'var(--muted)' }}>
          {f.t >= 0 ? fmtDur(f.rpo) : '–'}
        </text>
        <text x={464} y={92} className="viz-label">
          RTO (downtime)
        </text>
        <text x={464} y={112} style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--f-mono)', fill: done ? 'var(--bad)' : 'var(--muted)' }}>
          {done ? fmtDur(f.rto) : f.t >= 0 ? `≥ ${fmtDur(f.t)}` : '–'}
        </text>
        <text x={464} y={134} className="viz-label" style={{ fontSize: 10 }}>
          {f.t >= 0 ? `${f.lostWrites.toLocaleString('en-US')} writes at risk` : `${params.strategy === 'backup' ? 'RPO = backup age' : 'RPO ≈ lag'}`}
        </text>

        {/* RTO decomposition */}
        <text x={8} y={176} className="viz-label">
          time to recover, part by part
        </text>
        {segs.map((s) => {
          const active = f.t >= s.from;
          return (
            <g key={s.kind}>
              <rect x={s.x + 1} y={184} width={s.w - 2} height={28} rx={6} fill={active ? SEG_SOFT[s.kind] : 'none'} stroke={SEG_COLOR[s.kind]} strokeWidth={1.5} strokeDasharray={active ? undefined : '4 3'} />
              {active && <rect x={s.x + 1} y={184} width={Math.max(0, Math.min(s.w - 2, xAt(f.t) - s.x - 1))} height={28} rx={6} fill={SEG_COLOR[s.kind]} opacity={0.35} />}
              <text x={s.x + 7} y={203} style={{ fontSize: 11, fontWeight: 800, fill: SEG_COLOR[s.kind] }}>
                {SEG_NAME[s.kind]}
              </text>
              <text x={s.x + 4} y={228} style={{ fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--f-mono)' }}>
                {active ? fmtDur(s.to - s.from) : '?'}
              </text>
            </g>
          );
        })}
        {f.t >= 0 && <line x1={xAt(f.t)} y1={180} x2={xAt(f.t)} y2={216} stroke="var(--text)" strokeWidth={2} />}
        <text x={8} y={250} className="viz-label" style={{ fontSize: 11 }}>
          {segs.find((s) => f.t >= s.from && f.t < s.to)?.label ?? (f.t < 0 ? 'nothing is wrong yet' : done ? 'recovered' : '')}
        </text>
        <text x={8} y={274} className="viz-label">
          {done ? (
            <>
              RTO = {segs.map((s) => `${SEG_NAME[s.kind]} ${fmtDur(s.to - s.from)}`).join(' + ')} ={' '}
              <tspan style={{ fontWeight: 800, fill: 'var(--text)' }}>{fmtDur(f.rto)}</tspan>
            </>
          ) : (
            `RTO = ${segs.map((s) => SEG_NAME[s.kind]).join(' + ')} (fills in as you step)`
          )}
        </text>
      </svg>
    </VizFrame>
  );
}
