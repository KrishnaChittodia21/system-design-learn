import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { clampParams, simulate, type MsgKind, type Outcome, type Params, type Repair } from './sim';

const MSG_COLOR: Record<MsgKind, string> = {
  write: 'var(--accent)',
  ack: 'var(--accent)',
  read: 'var(--warn)',
  reply: 'var(--warn)',
  repair: 'var(--good)',
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  ok: 'var(--good)',
  fresh: 'var(--good)',
  stale: 'var(--bad)',
  fail: 'var(--bad)',
  pending: 'var(--text-2)',
};

export default function QuorumViz() {
  const [raw, setRaw] = useState<Params>({ n: 3, w: 2, r: 2, repair: 'off' });
  const params = clampParams(raw);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { n, w, r } = params;
  const setNum = (k: 'n' | 'w' | 'r') => (v: number) => setRaw((p) => clampParams({ ...p, [k]: v }));

  const slot = 560 / n;
  const bw = Math.min(72, slot - 12);
  const boxY = 196;
  const cx = (i: number) => 20 + slot * i + slot / 2;
  const coord = { x: 300, y: 70 };
  const maxVer = Math.max(...f.replicas.map((x) => x.ver));
  const overlapGuaranteed = r + w > n;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Replicas N" value={n} min={3} max={7} onChange={setNum('n')} />
          <Slider label="Write quorum W" value={w} min={1} max={n} onChange={setNum('w')} />
          <Slider label="Read quorum R" value={r} min={1} max={n} onChange={setNum('r')} />
          <Choice<Repair>
            label="Read repair"
            value={params.repair}
            options={[
              { value: 'off', label: 'off' },
              { value: 'blocking', label: 'blocking (before return)' },
            ]}
            onChange={(v) => setRaw((p) => ({ ...p, repair: v }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> write / ack (W set)
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> read / reply (R set)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> read repair · newest version
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> down / stale result
        </>
      }
    >
      <svg
        viewBox="0 0 600 310"
        className="viz-svg"
        role="img"
        aria-label={`N=${n}, W=${w}, R=${r}. Replicas: ${f.replicas.map((x, i) => `R${i + 1} ${x.status === 'down' ? 'down' : `${x.val} v${x.ver}`}`).join(', ')}.${f.result ? ` ${f.client}: ${f.result}.` : ''}`}
      >
        <text x={590} y={18} textAnchor="end" className="viz-label">
          Act {f.act}: {f.act === 1 ? 'write with a replica down, then read' : 'read during a write'}
        </text>

        {/* client */}
        <rect x={10} y={46} width={170} height={48} rx={10} fill="var(--surface-2)" stroke={f.outcome ? OUTCOME_COLOR[f.outcome] : 'var(--border)'} strokeWidth={2} />
        <text x={95} y={65} textAnchor="middle" className="viz-node-label">
          {f.client}
        </text>
        <text x={95} y={84} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: f.outcome ? OUTCOME_COLOR[f.outcome] : 'var(--text-2)' }}>
          {f.result ?? ' '}
        </text>
        <line x1={182} y1={70} x2={238} y2={70} className="viz-edge" />

        {/* coordinator */}
        <rect x={240} y={48} width={120} height={44} rx={10} fill="var(--surface-2)" stroke="var(--border)" strokeWidth={2} />
        <text x={300} y={75} textAnchor="middle" className="viz-node-label">
          coordinator
        </text>

        {/* messages */}
        {f.msgs.map((m, k) => {
          const toReplica = m.kind === 'write' || m.kind === 'read' || m.kind === 'repair';
          const x2 = cx(m.to);
          const end = toReplica ? { x: x2, y: boxY - 4 } : { x: coord.x, y: coord.y + 24 };
          const start = toReplica ? { x: coord.x, y: coord.y + 24 } : { x: x2, y: boxY - 4 };
          return (
            <g key={k}>
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={MSG_COLOR[m.kind]} strokeWidth={2} strokeDasharray={m.kind === 'write' && f.replicas[m.to].status === 'slow' ? '5 4' : undefined} />
              <circle cx={end.x} cy={end.y} r={4} fill={MSG_COLOR[m.kind]} />
            </g>
          );
        })}

        {/* replicas */}
        {f.replicas.map((rep, i) => {
          const x = cx(i);
          const inW = f.acked.includes(i);
          const inR = f.readSet.includes(i);
          const down = rep.status === 'down';
          const newest = rep.ver === maxVer && maxVer > 1;
          return (
            <g key={i}>
              {inW && (
                <text x={x - 12} y={boxY - 12} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: 'var(--accent)' }}>
                  W
                </text>
              )}
              {inR && (
                <text x={x + 12} y={boxY - 12} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: 'var(--warn)' }}>
                  R
                </text>
              )}
              <rect
                x={x - bw / 2}
                y={boxY}
                width={bw}
                height={66}
                rx={9}
                fill={down ? 'var(--bad-soft)' : newest ? 'var(--good-soft)' : 'var(--surface-2)'}
                stroke={down ? 'var(--bad)' : inW && inR ? 'var(--good)' : inR ? 'var(--warn)' : inW ? 'var(--accent)' : 'var(--border)'}
                strokeWidth={inW || inR ? 3 : 2}
                strokeDasharray={down ? '5 4' : undefined}
                style={{ transition: 'fill .3s, stroke .3s' }}
              />
              <text x={x} y={boxY + 18} textAnchor="middle" className="viz-label">
                R{i + 1}
              </text>
              <text x={x} y={boxY + 40} textAnchor="middle" style={{ fontSize: 17, fontWeight: 700, opacity: down ? 0.45 : 1 }}>
                {rep.val}
              </text>
              <text x={x} y={boxY + 58} textAnchor="middle" className="viz-label">
                {down ? 'down' : rep.status === 'slow' ? `v${rep.ver} · slow` : `v${rep.ver}`}
              </text>
              {inW && inR && (
                <text x={x} y={boxY + 82} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: 'var(--good)' }}>
                  overlap
                </text>
              )}
            </g>
          );
        })}

        {/* rule */}
        <text x={300} y={302} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: overlapGuaranteed ? 'var(--good)' : 'var(--bad)' }}>
          R + W = {r + w} {overlapGuaranteed ? '>' : '≤'} N = {n}: {overlapGuaranteed ? 'read and write sets must overlap' : 'a read can miss every written replica'}
        </text>
      </svg>
    </VizFrame>
  );
}
