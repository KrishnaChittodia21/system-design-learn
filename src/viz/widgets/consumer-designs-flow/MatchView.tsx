import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Halo, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { simulateMatch, type MatchDesign, type MatchParams } from './sim';

const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
];

export default function MatchView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<MatchParams>({ design: 'partitions', lag: true, retry: true });
  const frames = useSimulation(simulateMatch, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const pair = params.design === 'pair';

  const nodes: Record<string, NodeDef> = {
    a: { id: 'a', label: 'Alice (A)', sub: 'swipes right on B', x: 8, y: 16, w: 124, h: 46 },
    api: { id: 'api', label: 'Swipe API', sub: pair ? 'EVAL swipe.lua' : 'write mine, read theirs', x: 238, y: 16, w: 124, h: 46 },
    b: { id: 'b', label: 'Bob (B)', sub: 'swipes right on A', x: 468, y: 16, w: 124, h: 46 },
    p1: { id: 'p1', label: 'Partition 1', sub: 'likes by A', x: 108, y: 104, w: 150, h: 46 },
    p2: { id: 'p2', label: 'Partition 2', sub: params.lag ? 'likes by B · replica lags' : 'likes by B', x: 342, y: 104, w: 150, h: 46 },
    pair: { id: 'pair', label: 'Redis slot', sub: 'hash tag {A:B}', x: 200, y: 104, w: 200, h: 46 },
  };
  const shown = pair ? ['a', 'api', 'b', 'pair'] : ['a', 'api', 'b', 'p1', 'p2'];
  const aria = `Tinder step ${stepper.i + 1}: ${f.matches} matches, ${f.pushes} pushes so far using ${pair ? 'a single pair key' : 'two partitions'}.`;

  return (
    <VizFrame
      title="Tinder: two right swipes, exactly one match"
      blurb="Alice and Bob swipe right on each other 2 ms apart. Store likes per swiper on two partitions (with or without replica lag), or both sides in one pair key with HSETNX, and count the matches."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<MatchDesign>
            label="Swipe state"
            value={params.design}
            options={[
              { value: 'partitions', label: 'Two partitions' },
              { value: 'pair', label: 'One pair key + HSETNX' },
            ]}
            onChange={(design) => setParams((p) => ({ ...p, design }))}
          />
          {pair ? (
            <Choice<'on' | 'off'> label="Client retries the swipe" value={params.retry ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, retry: v === 'on' }))} />
          ) : (
            <Choice<'on' | 'off'> label="Replica lag" value={params.lag ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, lag: v === 'on' }))} />
          )}
        </>
      }
      legend={
        <>
          <Key tone="accent" /> write / script
          <Key tone="good" /> exactly-once match
          <Key tone="warn" /> duplicate match
          <Key tone="bad" /> missed read
        </>
      }
    >
      <svg viewBox="0 0 600 316" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        <Edge a={nodes.a} b={nodes.api} dashed />
        <Edge a={nodes.b} b={nodes.api} dashed />
        {pair ? <Edge a={nodes.api} b={nodes.pair} dashed /> : (
          <>
            <Edge a={nodes.api} b={nodes.p1} dashed />
            <Edge a={nodes.api} b={nodes.p2} dashed />
          </>
        )}
        {shown.map((id) => (
          <Box key={id} n={nodes[id]} tone={f.active[id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} packet k={`${stepper.i}-${k}`} />
        ))}
        {/* storage contents */}
        {f.store.map((s, k) => {
          const box = pair ? nodes.pair : k === 0 ? nodes.p1 : nodes.p2;
          return (
            <g key={s.key}>
              <text x={box.x + box.w / 2} y={box.y + box.h + 16} textAnchor="middle" fontSize={9.5} fontFamily="var(--f-mono)" className="csf-muted">
                {s.key}
              </text>
              {s.fields.length === 0 ? (
                <text x={box.x + box.w / 2} y={box.y + box.h + 32} textAnchor="middle" fontSize={10} className="csf-muted">
                  (empty)
                </text>
              ) : (
                s.fields.map((fl, j) => <Pill key={fl} x={box.x + box.w / 2 + (j - (s.fields.length - 1) / 2) * 52} y={box.y + box.h + 32} text={fl} tone={fl === 'm=1' ? 'good' : 'accent'} anchor="middle" size={10} />)
              )}
            </g>
          );
        })}
        {/* counters */}
        <Halo x={590} y={92} anchor="end" text={`matches: ${f.matches} · pushes: ${f.pushes}`} size={11.5} weight={800} tone={f.matches === 1 ? 'good' : f.matches > 1 ? 'warn' : undefined} />

        <Panel x={8} y={198} w={584} h={112} title="Operations in time order">
          {f.ops.length === 0 && (
            <text x={18} y={226} fontSize={10.5} className="csf-muted">
              nothing yet
            </text>
          )}
          {f.ops.map((o, k) => (
            <g key={k} className="csf-pop">
              <text x={18} y={228 + k * 20} fontSize={10.5} fontFamily="var(--f-mono)" className="csf-muted">
                t={o.at}ms
              </text>
              <Pill x={84} y={226 + k * 20} text={o.who} tone={o.who === 'A' ? 'accent' : 'mag'} size={9.5} />
              <Halo x={112} y={228 + k * 20} text={o.text} size={10.5} anchor="start" weight={600} tone={o.tone === 'accent' ? undefined : o.tone} />
            </g>
          ))}
        </Panel>
      </svg>
    </VizFrame>
  );
}
