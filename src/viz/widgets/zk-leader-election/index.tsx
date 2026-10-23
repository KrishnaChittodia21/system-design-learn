import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { cname, seqName, simulate, type ClientState, type Params, type Scenario, type WatchMode } from './sim';

const STATE_STYLE: Record<ClientState, { stroke: string; fill: string; label: string }> = {
  idle: { stroke: 'var(--border-strong)', fill: 'var(--surface)', label: 'joining' },
  leader: { stroke: 'var(--good)', fill: 'var(--good-soft)', label: 'LEADER' },
  waiting: { stroke: 'var(--accent)', fill: 'var(--surface)', label: 'waiting' },
  stalled: { stroke: 'var(--warn)', fill: 'var(--warn-soft)', label: 'GC pause' },
  expired: { stroke: 'var(--bad)', fill: 'var(--bad-soft)', label: 'session expired' },
  confused: { stroke: 'var(--warn)', fill: 'var(--warn-soft)', label: 'owns a ghost' },
};
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

export default function ZkLeaderElectionViz() {
  const [params, setParams] = useState<Params>({ clients: 4, watch: 'predecessor', scenario: 'crash' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const ZX = 14;
  const ZW = 214;
  const zRow = (i: number) => 66 + i * 30;
  const CX = 340;
  const CW = 170;
  const cRow = (i: number) => 40 + i * 42;
  const sorted = [...f.znodes].sort((a, b) => a.seq - b.seq);
  const zIndex = (seq: number) => sorted.findIndex((z) => z.seq === seq);
  const H = 340;

  const aria =
    `Znodes under /election: ${sorted.map((z) => `${seqName(z.seq)} owned by ${cname(z.owner)}${z.ghost ? ' (ghost)' : ''}`).join(', ') || 'none'}. ` +
    f.clients.map((c) => `${cname(c.id)} ${STATE_STYLE[c.state].label}${c.watching === -1 ? ', watching /election children' : c.watching !== null ? `, watching ${seqName(c.watching)}` : ''}`).join('; ') +
    (f.notified.length ? `. Notified: ${f.notified.map(cname).join(', ')}` : '');

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Scenario"
            value={params.scenario}
            options={[
              { value: 'crash', label: 'leader pauses' },
              { value: 'ghost-naive', label: 'lost create reply, blind retry' },
              { value: 'ghost-protected', label: 'lost reply, protection mode' },
            ]}
            onChange={set('scenario')}
          />
          <Choice<WatchMode>
            label="Each waiter watches"
            value={params.watch}
            options={[
              { value: 'predecessor', label: 'its predecessor' },
              { value: 'parent', label: 'all children (herd)' },
            ]}
            onChange={set('watch')}
          />
          <Slider label="Clients" value={params.clients} min={3} max={6} onChange={set('clients')} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> leader
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> watch
          <span className="viz-key" style={{ background: 'var(--mag)' }} /> watch event delivered
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> ghost / paused
        </>
      }
    >
      <svg viewBox={`0 0 520 ${H}`} className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="zk-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
          <marker id="zk-arr-ev" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--mag)" />
          </marker>
        </defs>

        {/* znode tree */}
        <rect x={ZX} y={16} width={ZW} height={30} rx={8} fill="var(--surface)" stroke="var(--border-strong)" />
        <text x={ZX + 10} y={36} fontSize={11.5} fontWeight={700} fontFamily="var(--f-mono)">
          /election
        </text>
        <text x={ZX + ZW - 8} y={36} fontSize={9} textAnchor="end" className="viz-label">
          persistent
        </text>
        <line x1={ZX + 12} x2={ZX + 12} y1={46} y2={Math.max(46, zRow(sorted.length - 1) + 13)} stroke="var(--border)" />
        {sorted.map((z, i) => {
          const owner = f.clients[z.owner];
          const isLeader = owner.state === 'leader' && owner.mine === z.seq;
          return (
            <g key={z.seq}>
              <line x1={ZX + 12} x2={ZX + 22} y1={zRow(i) + 13} y2={zRow(i) + 13} stroke="var(--border)" />
              <rect
                x={ZX + 22}
                y={zRow(i)}
                width={ZW - 22}
                height={26}
                rx={6}
                fill={isLeader ? 'var(--good-soft)' : z.ghost ? 'var(--warn-soft)' : 'var(--surface)'}
                stroke={isLeader ? 'var(--good)' : z.ghost ? 'var(--warn)' : 'var(--border-strong)'}
                strokeDasharray={z.ghost ? '4 3' : undefined}
              />
              <text x={ZX + 30} y={zRow(i) + 17} fontSize={10.5} fontFamily="var(--f-mono)" fontWeight={600}>
                {z.guid ? `_c_${z.guid}-` : ''}
                {seqName(z.seq)}
              </text>
              <text x={ZX + ZW - 6} y={zRow(i) + 17} fontSize={9.5} textAnchor="end" style={{ fill: z.ghost ? 'var(--warn)' : 'var(--text-2)' }} fontWeight={z.ghost ? 700 : 400}>
                {z.ghost ? `ghost · ${cname(z.owner)}` : cname(z.owner)}
              </text>
            </g>
          );
        })}

        {/* watches */}
        {f.clients.map((c, i) => {
          if (c.watching === null) return null;
          const y1 = cRow(i) + 17;
          const toParent = c.watching === -1;
          const zi = toParent ? -1 : zIndex(c.watching);
          if (!toParent && zi < 0) return null;
          const y2 = toParent ? 31 : zRow(zi) + 13;
          const x2 = ZX + ZW + 4;
          const ev = f.notified.includes(c.id);
          return (
            <path
              key={`w${c.id}`}
              d={`M${CX - 2},${y1} C${CX - 50},${y1} ${x2 + 50},${y2} ${x2},${y2}`}
              fill="none"
              stroke={ev ? 'var(--mag)' : 'var(--accent)'}
              strokeWidth={ev ? 2.4 : 1.3}
              strokeDasharray={ev ? undefined : '4 3'}
              markerEnd={`url(#${ev ? 'zk-arr-ev' : 'zk-arr'})`}
              opacity={0.85}
            />
          );
        })}
        {/* event arrows for notified clients whose watch target is gone */}
        {f.notified.map((id) => {
          const i = f.clients.findIndex((c) => c.id === id);
          return (
            <text key={`ev${id}`} x={CX - 6} y={cRow(i) + 8} textAnchor="end" fontSize={10} fontWeight={700} style={{ fill: 'var(--mag)', ...halo }}>
              ⚡ NodeDeleted
            </text>
          );
        })}

        {/* clients */}
        {f.clients.map((c, i) => {
          const st = STATE_STYLE[c.state];
          return (
            <g key={c.id}>
              <rect x={CX} y={cRow(i)} width={CW} height={34} rx={8} fill={st.fill} stroke={f.notified.includes(c.id) ? 'var(--mag)' : st.stroke} strokeWidth={c.state === 'leader' || f.notified.includes(c.id) ? 2.5 : 1.2} style={{ transition: 'fill .3s, stroke .3s' }} />
              <text x={CX + 10} y={cRow(i) + 15} fontSize={11.5} fontWeight={700}>
                {cname(c.id)}
              </text>
              <text x={CX + 10} y={cRow(i) + 28} fontSize={9.5} className="viz-label">
                {c.mine !== null ? `mine: …${String(c.mine).padStart(2, '0')}` : 'no node yet'}
              </text>
              <text x={CX + CW - 8} y={cRow(i) + 21} textAnchor="end" fontSize={10} fontWeight={700} style={{ fill: st.stroke }}>
                {st.label}
              </text>
            </g>
          );
        })}

        {/* footer */}
        <text x={ZX} y={H - 28} fontSize={10} className="viz-label">
          last zxid 0x{f.zxid.toString(16)} (epoch 7) · getChildren this step: {f.reads}
        </text>
        {f.sessionNote && (
          <text x={ZX} y={H - 12} fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)' }}>
            {f.sessionNote}
          </text>
        )}
        {f.fence.rejected !== null && (
          <g>
            <rect x={CX} y={H - 46} width={CW} height={40} rx={8} fill="var(--bad-soft)" stroke="var(--bad)" />
            <text x={CX + 8} y={H - 30} fontSize={10} fontWeight={700} style={{ fill: 'var(--bad)' }}>
              storage: token {f.fence.rejected} &lt; {f.fence.leaderToken}
            </text>
            <text x={CX + 8} y={H - 15} fontSize={10} fontWeight={700} style={{ fill: 'var(--bad)' }}>
              write REJECTED
            </text>
          </g>
        )}
      </svg>
    </VizFrame>
  );
}
