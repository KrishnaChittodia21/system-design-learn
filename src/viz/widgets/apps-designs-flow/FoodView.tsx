import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Halo, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { READY_IN, simulateFood, type FoodParams, type FoodScenario, type OrderStatus } from './sim';
import { soft, stroke } from './tones';

const FLOW: OrderStatus[] = ['PAYMENT_PENDING', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERED'];
const SHORT: Record<OrderStatus, string> = {
  PAYMENT_PENDING: 'PAY_PENDING',
  PLACED: 'PLACED',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  PICKED_UP: 'PICKED_UP',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
};
const ACTORS: NodeDef[] = [
  { id: 'psp', label: 'Payment PSP', x: 4, y: 100, w: 96, h: 30 },
  { id: 'resto', label: 'Restaurant', x: 4, y: 140, w: 96, h: 30 },
  { id: 'cust', label: 'Customer', x: 4, y: 180, w: 96, h: 30 },
  { id: 'orders', label: 'Order service', sub: 'transition table + version', x: 176, y: 130, w: 146, h: 46 },
  { id: 'timer', label: 'Durable timer', sub: 'accept SLA 90 s', x: 356, y: 92, w: 116, h: 38 },
  { id: 'dispatch', label: 'Dispatcher', sub: 'JIT, offers + TTL', x: 356, y: 188, w: 116, h: 38 },
  { id: 'p', label: 'Partners', sub: 'offer / accept', x: 490, y: 140, w: 102, h: 40 },
];
const LINKS: [string, string][] = [
  ['psp', 'orders'],
  ['resto', 'orders'],
  ['cust', 'orders'],
  ['timer', 'orders'],
  ['orders', 'dispatch'],
  ['dispatch', 'p'],
  ['p', 'orders'],
];
const OFFER_TONE = { none: 'muted', offered: 'accent', expired: 'warn', accepted: 'good', 'rejected-late': 'bad' } as const;

export default function FoodView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<FoodParams>({ scenario: 'happy', offerExpires: true });
  const frames = useSimulation(simulateFood, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = Object.fromEntries(ACTORS.map((n) => [n.id, n]));
  const curIdx = FLOW.indexOf(f.status);
  const aria = `Food order step ${stepper.i + 1}: status ${f.status}, version ${f.version}. ${f.refund}`;

  return (
    <VizFrame
      title="Food delivery: the order state machine and dispatch"
      blurb="Drive one order through its lifecycle. Leave the restaurant silent, race a cancel against an accept, replay late events, and let the first partner's offer expire."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<FoodScenario>
            label="Scenario"
            value={params.scenario}
            options={[
              { value: 'happy', label: 'Happy path' },
              { value: 'timeout', label: 'Restaurant silent' },
              { value: 'race', label: 'Cancel vs accept' },
              { value: 'late', label: 'Late + duplicate events' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Choice<'on' | 'off'>
            label="First offer expires"
            value={params.offerExpires ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, offerExpires: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> current state / event
          <Key tone="good" /> transition applied
          <Key tone="warn" /> illegal (late) event, logged
          <Key tone="bad" /> 0 rows / duplicate / cancelled
        </>
      }
    >
      <svg viewBox="0 0 600 344" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {/* state machine */}
        {FLOW.map((s, k) => {
          const x = 4 + k * 84;
          const done = f.status !== 'CANCELLED' && k < curIdx;
          const cur = k === curIdx;
          const tone = cur ? 'accent' : done ? 'good' : 'muted';
          return (
            <g key={s}>
              <rect x={x} y={8} width={78} height={30} rx={7} fill={cur || done ? soft(tone) : 'var(--surface)'} stroke={cur || done ? stroke(tone) : 'var(--line-2)'} strokeWidth={cur ? 2.4 : 1.2} style={{ transition: 'all 0.3s ease' }} />
              <text x={x + 39} y={27} textAnchor="middle" fontSize={9.5} fontWeight={700}>
                {SHORT[s]}
              </text>
              {k < FLOW.length - 1 && <path d={`M${x + 79},23 l4,0`} stroke="var(--ink-4)" strokeWidth={1.4} />}
            </g>
          );
        })}
        <rect x={88} y={52} width={162} height={26} rx={7} fill={f.status === 'CANCELLED' ? 'var(--bad-soft)' : 'var(--surface)'} stroke={f.status === 'CANCELLED' ? 'var(--bad)' : 'var(--line-2)'} strokeWidth={f.status === 'CANCELLED' ? 2.4 : 1.2} />
        <text x={169} y={69} textAnchor="middle" fontSize={9.5} fontWeight={700}>
          CANCELLED {f.refund ? `· ${f.refund}` : ''}
        </text>
        <path d="M130,38 L130,52 M214,38 L214,52" stroke="var(--ink-4)" strokeDasharray="3 2" />
        <Halo x={590} y={70} anchor="end" text={`version ${f.version}`} size={10.5} weight={800} />

        {LINKS.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {ACTORS.map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} dim={Object.keys(f.active).length > 0 && !f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} packet k={`${stepper.i}-${k}`} />
        ))}

        <Panel x={8} y={234} w={360} h={104} title="Event log (newest last)">
          {f.log.slice(-5).map((l, k) => (
            <g key={`${f.log.length}-${k}`}>
              <text x={18} y={262 + k * 15} fontSize={9.5} fontWeight={700}>
                {l.actor}: {l.event}
              </text>
              <text x={358} y={262 + k * 15} fontSize={9.5} textAnchor="end" style={{ fill: stroke(l.tone) }} fontWeight={700}>
                {l.result}
              </text>
            </g>
          ))}
        </Panel>
        <Panel x={376} y={234} w={216} h={104} title={`Partners · food ready in ${READY_IN} min`}>
          {f.partners.map((p, k) => (
            <g key={p.id}>
              <text x={386} y={262 + k * 22} fontSize={10} fontWeight={800}>
                {p.id}
              </text>
              <text x={410} y={262 + k * 22} fontSize={9.5} className="adf-muted">
                {p.eta} min · cost {p.cost}
              </text>
              {p.offer !== 'none' && <Pill x={584} y={260 + k * 22} text={p.offer} tone={OFFER_TONE[p.offer]} anchor="end" size={8.5} />}
            </g>
          ))}
        </Panel>
      </svg>
    </VizFrame>
  );
}
