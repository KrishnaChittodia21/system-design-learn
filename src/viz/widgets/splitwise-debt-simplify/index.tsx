import { useMemo, useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { dataset, rawTransfers, simplifyGreedy, simplifyOptimal, simulate, type Algo, type Dataset, type Params } from './sim';
import './splitwise.css';

const CX = 300;
const CY = 146;
const R = 104;
const NODE_R = 30;
const GROUP_COLOR = ['var(--accent)', 'var(--warn)', 'var(--mag)'];

export default function SplitwiseViz() {
  const [params, setParams] = useState<Params>({ algo: 'greedy', data: 'counter' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const hasLedger = params.data !== 'counter';

  const counts = useMemo(() => {
    const d = dataset(params.data);
    return {
      raw: d.expenses ? rawTransfers(d.expenses).length : null,
      greedy: simplifyGreedy(d.net, d.people).length,
      optimal: simplifyOptimal(d.net).length,
    };
  }, [params.data]);

  const pos = (u: string) => {
    const i = f.people.indexOf(u);
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / f.people.length;
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  };
  const groupOf = (u: string) => f.groups.findIndex((g) => g.includes(u));

  const ariaLabel = `Balances: ${f.people.map((u) => `${u} ${f.net[u] > 0 ? 'is owed' : f.net[u] < 0 ? 'owes' : 'settled'} ${f.net[u] ? `₹${Math.abs(f.net[u])}` : ''}`).join('; ')}. ${
    f.transfers.length
  } transfer(s) so far${f.transfers.length ? `: ${f.transfers.map((t) => `${t.from} pays ${t.to} ₹${t.amount}`).join('; ')}` : ''}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Dataset>
            label="Group"
            value={params.data}
            options={[
              { value: 'counter', label: '5-person counterexample' },
              { value: 'trip', label: 'Goa trip ledger' },
              { value: 'chain', label: 'Debt chain' },
            ]}
            onChange={(data) => setParams((p) => ({ data, algo: data === 'counter' && p.algo === 'raw' ? 'greedy' : p.algo }))}
          />
          <Choice<Algo>
            label="Settle by"
            value={params.algo}
            options={[
              ...(hasLedger ? [{ value: 'raw' as Algo, label: 'Pay back each expense' }] : []),
              { value: 'greedy', label: 'Greedy' },
              { value: 'optimal', label: 'Exact minimum' },
            ]}
            onChange={(algo) => setParams((p) => ({ ...p, algo }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> is owed (+)
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> owes (−)
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> latest transfer
          {params.algo === 'optimal' && (
            <>
              <span className="viz-key ring" style={{ borderColor: 'var(--accent)' }} /> zero-sum group
            </>
          )}
        </>
      }
    >
      <svg viewBox="0 0 600 296" className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          {['cur', 'old'].map((k) => (
            <marker key={k} id={`sw-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={k === 'cur' ? 'var(--accent)' : 'var(--muted)'} />
            </marker>
          ))}
        </defs>

        {/* transfers as curved arrows (curved so A→B and B→A don't overlap) */}
        {f.transfers.map((t, k) => {
          const a = pos(t.from);
          const b = pos(t.to);
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          const sx = a.x + ux * (NODE_R + 2);
          const sy = a.y + uy * (NODE_R + 2);
          const ex = b.x - ux * (NODE_R + 4);
          const ey = b.y - uy * (NODE_R + 4);
          const bend = 22;
          const mx = (sx + ex) / 2 - uy * bend;
          const my = (sy + ey) / 2 + ux * bend;
          const latest = k === f.transfers.length - 1 && !f.done;
          return (
            <g key={k} opacity={latest || f.done ? 1 : 0.55}>
              <path
                d={`M${sx},${sy} Q${mx},${my} ${ex},${ey}`}
                fill="none"
                stroke={latest ? 'var(--accent)' : 'var(--muted)'}
                strokeWidth={latest ? 2.6 : 1.5}
                markerEnd={`url(#sw-arrow-${latest ? 'cur' : 'old'})`}
              />
              <text
                x={0.36 * sx + 0.48 * mx + 0.16 * ex - uy * 7}
                y={0.36 * sy + 0.48 * my + 0.16 * ey + ux * 7 + 4}
                textAnchor="middle"
                style={{ fontSize: 10.5, fontWeight: 700, fill: latest ? 'var(--accent)' : 'var(--ink-2)' }}
              >
                ₹{t.amount}
              </text>
            </g>
          );
        })}

        {/* people */}
        {f.people.map((u) => {
          const { x, y } = pos(u);
          const v = f.net[u];
          const g = groupOf(u);
          const tone = v > 0 ? 'var(--good)' : v < 0 ? 'var(--bad)' : 'var(--border)';
          return (
            <g key={u}>
              {g >= 0 && <circle cx={x} cy={y} r={NODE_R + 6} fill="none" stroke={GROUP_COLOR[g % GROUP_COLOR.length]} strokeWidth={2} strokeDasharray="5 3" />}
              <circle cx={x} cy={y} r={NODE_R} fill={v > 0 ? 'var(--good-soft)' : v < 0 ? 'var(--bad-soft)' : 'var(--surface)'} stroke={tone} strokeWidth={2} />
              <text x={x} y={y - 3} textAnchor="middle" className="viz-node-label" style={{ fontSize: u.length > 3 ? 11 : 13 }}>
                {u}
              </text>
              <text x={x} y={y + 12} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 700, fill: v ? tone : 'var(--muted)' }}>
                {v > 0 ? `+₹${v}` : v < 0 ? `−₹${-v}` : 'settled'}
              </text>
            </g>
          );
        })}
        {params.algo === 'optimal' &&
          f.groups.map((g, k) => (
            <text key={k} x={10} y={18 + k * 16} style={{ fontSize: 11, fontWeight: 700, fill: GROUP_COLOR[k % GROUP_COLOR.length] }}>
              group {k + 1}: {`{${g.join(', ')}}`} sums to 0
            </text>
          ))}
        <text x={590} y={18} textAnchor="end" className="viz-label">
          transfers so far: {f.transfers.length}
        </text>
      </svg>
      <div className="sw-counts" aria-label="Transfers needed by each method">
        {counts.raw !== null && (
          <span className={`sw-count ${params.algo === 'raw' ? 'on' : ''}`}>
            pay back each expense <strong>{counts.raw}</strong>
          </span>
        )}
        <span className={`sw-count ${params.algo === 'greedy' ? 'on' : ''}`}>
          greedy <strong>{counts.greedy}</strong>
        </span>
        <span className={`sw-count ${params.algo === 'optimal' ? 'on' : ''}`}>
          exact minimum <strong>{counts.optimal}</strong>
        </span>
      </div>
    </VizFrame>
  );
}
