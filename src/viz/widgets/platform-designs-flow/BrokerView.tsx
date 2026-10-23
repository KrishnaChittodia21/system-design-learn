import { useState, type ReactNode } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { CASH, LIMIT, STATES, simulateBroker, type BrokerParams, type BrokerScenario } from './sim';

const NODES: NodeDef[] = [
  { id: 'app', label: 'App', sub: 'Buy AAPL', x: 4, y: 14, w: 100, h: 44 },
  { id: 'gw', label: 'API gateway', sub: 'idempotency key', x: 120, y: 14, w: 104, h: 44 },
  { id: 'order', label: 'Order service', sub: 'validate · risk', x: 240, y: 14, w: 104, h: 44 },
  { id: 'pg', label: 'Postgres', sub: 'order + outbox', x: 360, y: 14, w: 104, h: 44 },
  { id: 'kafka', label: 'Kafka', sub: 'orders by account', x: 480, y: 14, w: 116, h: 44 },
  { id: 'stream', label: 'User stream', sub: 'WebSocket', x: 4, y: 96, w: 100, h: 44 },
  { id: 'exec', label: 'Exec processor', sub: 'idempotent', x: 120, y: 96, w: 104, h: 44 },
  { id: 'venue', label: 'Venue', sub: 'market maker', x: 240, y: 96, w: 104, h: 44 },
  { id: 'fix', label: 'FIX gateway', sub: 'ClOrdID = id', x: 360, y: 96, w: 104, h: 44 },
  { id: 'sor', label: 'Smart router', sub: 'best execution', x: 480, y: 96, w: 116, h: 44 },
];
const PILL_POS = [
  [18, 188],
  [100, 188],
  [170, 188],
  [18, 210],
  [140, 210],
];
const COLS = [326, 372, 466, 526];
const LINKS: [string, string][] = [
  ['app', 'gw'],
  ['gw', 'order'],
  ['order', 'pg'],
  ['pg', 'kafka'],
  ['kafka', 'sor'],
  ['sor', 'fix'],
  ['fix', 'venue'],
  ['venue', 'exec'],
  ['exec', 'stream'],
];

export default function BrokerView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<BrokerParams>({ qty: 10, scenario: 'dup' });
  const frames = useSimulation(simulateBroker, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const free = CASH - f.reserved - f.spent;
  const bar = { x: 18, y: 250, w: 280 };
  const sx = (v: number) => (v / CASH) * bar.w;
  const aria = `Brokerage step ${stepper.i + 1}: order ${f.state}, reserved $${f.reserved}, spent $${f.spent}, position ${f.position} shares, ${f.ordersAtVenue} order at the venue.`;

  return (
    <VizFrame
      title="Brokerage: one buy order, from reservation to fills"
      blurb="Change the quantity (past $2,500 the risk check rejects it) and inject a duplicate fill or a FIX gateway crash. Watch buying power, the order state machine and the execution reports."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Slider label={`Quantity at $${LIMIT} limit`} value={params.qty} min={5} max={14} onChange={(qty) => setParams((p) => ({ ...p, qty }))} format={(q) => `${q} ($${(q * LIMIT).toLocaleString('en-US')})`} />
          <Choice<BrokerScenario>
            label="Inject"
            value={params.scenario}
            options={[
              { value: 'normal', label: 'Nothing' },
              { value: 'dup', label: 'Duplicate fill report' },
              { value: 'crash', label: 'FIX gateway crash' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> message in flight
          <Key tone="good" /> committed / applied
          <Key tone="warn" /> duplicate
          <Key tone="bad" /> rejected / crashed
        </>
      }
    >
      <svg viewBox="0 0 600 336" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {LINKS.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {NODES.map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} dim={Object.keys(f.active).length > 0 && !f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={nodes[e.from].y === nodes[e.to].y ? 30 : -6} packet k={`${stepper.i}-${k}`} />
        ))}

        <Panel x={8} y={160} w={300} h={170} title="Order state machine">
          {STATES.map((s, k) => {
            const cur = STATES.indexOf(f.state as (typeof STATES)[number]);
            const tone = f.state === 'rejected' ? 'muted' : k < cur ? 'good' : k === cur ? 'accent' : 'muted';
            const [px, py] = PILL_POS[k];
            return <Pill key={s} x={px} y={py} text={s} tone={tone} size={9.5} />;
          })}
          {f.state === 'rejected' && <Pill x={210} y={210} text="rejected" tone="bad" size={9.5} />}
          <text x={18} y={240} fontSize={10.5} fontWeight={700}>
            Buying power ${CASH.toLocaleString('en-US')}
          </text>
          <rect x={bar.x} y={bar.y} width={bar.w} height={16} rx={4} fill="var(--tint)" stroke="var(--line-2)" />
          <rect x={bar.x} y={bar.y} width={sx(f.spent)} height={16} rx={4} fill="var(--good)" style={{ transition: 'width 0.35s ease' }} />
          <rect x={bar.x + sx(f.spent)} y={bar.y} width={sx(f.reserved)} height={16} fill="var(--warn)" opacity={0.6} style={{ transition: 'all 0.35s ease' }} />
          <text x={18} y={284} fontSize={10} className="pdf-muted">
            spent ${f.spent.toLocaleString('en-US')} · reserved ${f.reserved.toLocaleString('en-US')} · free ${free.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </text>
          <text x={18} y={304} fontSize={11} fontWeight={800}>
            Position: {f.position} AAPL
          </text>
          <text x={18} y={321} fontSize={10.5} fontWeight={700} style={{ fill: f.ordersAtVenue > 1 ? 'var(--bad)' : 'var(--ink-2)' }}>
            Orders at the venue: {f.ordersAtVenue}
          </text>
        </Panel>

        <Panel x={316} y={160} w={276} h={170} title="ExecutionReports (35=8) applied">
          {['ExecID', 'type', 'CumQty', 'booked'].map((h, k) => (
            <text key={h} x={COLS[k]} y={192} fontSize={9.5} fontWeight={700} className="pdf-muted">
              {h}
            </text>
          ))}
          {f.execs.length === 0 && (
            <text x={326} y={212} fontSize={10} className="pdf-muted">
              none yet
            </text>
          )}
          {f.execs.map((e, k) => (
            <g key={k} className="pdf-pop">
              {[e.execId, e.type, String(e.cumQty), e.applied ? `+${e.booked}` : 'ignored'].map((v, j) => (
                <text key={j} x={COLS[j]} y={212 + k * 20} fontSize={10} fontWeight={j === 3 ? 800 : 500} style={{ fill: !e.applied ? 'var(--warn)' : j === 3 && e.booked ? 'var(--good)' : 'var(--ink)' }}>
                  {v}
                </text>
              ))}
            </g>
          ))}
          <text x={326} y={318} fontSize={9.5} className="pdf-muted">
            key (venue, ExecID) · book CumQty growth
          </text>
        </Panel>
      </svg>
    </VizFrame>
  );
}
