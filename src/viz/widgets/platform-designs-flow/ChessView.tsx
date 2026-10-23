import { useState, type ReactNode } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { MAX_CREDIT_MS, simulateChess, type ChessParams, type ChessScenario } from './sim';
import { stroke } from './tones';

const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

export default function ChessView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<ChessParams>({ rttMs: 450, scenario: 'reconnect' });
  const frames = useSimulation(simulateChess, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = {
    white: { id: 'white', label: 'White', sub: '40 ms RTT', x: 4, y: 10, w: 116, h: 42 },
    black: { id: 'black', label: 'Black', sub: `${params.rttMs} ms RTT`, x: 4, y: 74, w: 116, h: 42 },
    gw: { id: 'gw', label: 'Gateway', sub: 'WebSocket tier', x: 168, y: 42, w: 116, h: 42 },
    owner: { id: 'owner', label: 'Game owner', sub: 'rules · clocks · timer', x: 346, y: 42, w: 134, h: 42 },
    log: { id: 'log', label: 'Move log', sub: 'Redis stream', x: 504, y: 42, w: 92, h: 42 },
  };
  const aria = `Chess step ${stepper.i + 1}: White ${clock(f.clocks[0])}, Black ${clock(f.clocks[1])}, ${f.toMove === 'W' ? 'White' : 'Black'} to move, next ply ${f.nextPly}. ${f.result}`;

  return (
    <VizFrame
      title="Online chess: one owner per game, server clocks, ply numbers"
      blurb="Play six plies of a bullet game. Slow down Black's network to see the capped lag credit, drop Black's connection mid-game, or start Black in a time scramble and let the server flag."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Slider label="Black's round trip" value={params.rttMs} min={50} max={800} step={50} onChange={(rttMs) => setParams((p) => ({ ...p, rttMs }))} format={(v) => `${v} ms`} />
          <Choice<ChessScenario>
            label="Scenario"
            value={params.scenario}
            options={[
              { value: 'normal', label: 'Clean game' },
              { value: 'reconnect', label: 'Reconnect + stale plies' },
              { value: 'flag', label: 'Black in time trouble' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> move in flight
          <Key tone="good" /> appended + broadcast
          <Key tone="warn" /> duplicate / reconnect
          <Key tone="bad" /> rejected / flagged
        </>
      }
    >
      <svg viewBox="0 0 600 340" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        <Edge a={nodes.white} b={nodes.gw} dashed />
        <Edge a={nodes.black} b={nodes.gw} dashed />
        <Edge a={nodes.gw} b={nodes.owner} dashed />
        <Edge a={nodes.owner} b={nodes.log} dashed />
        {Object.values(nodes).map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={e.from === 'black' ? 16 : -6} packet k={`${stepper.i}-${k}`} />
        ))}

        {(['W', 'B'] as const).map((side, k) => {
          const ms = f.clocks[k];
          const turn = f.toMove === side && !f.result.includes('wins');
          const x = 8 + k * 296;
          const low = ms < 5000;
          return (
            <g key={side}>
              <rect x={x} y={130} width={288} height={66} rx={10} fill={turn ? 'var(--blue-s)' : 'var(--surface)'} stroke={ms <= 0 ? 'var(--bad)' : turn ? 'var(--blue)' : 'var(--line-2)'} strokeWidth={turn ? 2.4 : 1.2} />
              <text x={x + 14} y={152} fontSize={11} fontWeight={700} style={{ fill: 'var(--ink-2)' }}>
                {side === 'W' ? 'White' : 'Black'} {turn ? '· to move (clock running on the server)' : ''}
              </text>
              <text x={x + 14} y={186} fontSize={26} fontWeight={800} fontFamily="var(--f-mono)" style={{ fill: ms <= 0 || low ? 'var(--bad)' : 'var(--ink)' }}>
                {clock(ms)}
              </text>
            </g>
          );
        })}
        <Pill x={592} y={110} text={f.result || `expecting ply ${f.nextPly}`} tone={f.result.includes('wins') ? 'bad' : 'accent'} anchor="end" size={10} />

        <Panel x={8} y={206} w={584} h={128} title={`Server log · charge = elapsed − lag credit (cap ${MAX_CREDIT_MS} ms)`}>
          {f.log.length === 0 && (
            <text x={18} y={236} fontSize={10.5} className="pdf-muted">
              no moves yet
            </text>
          )}
          {f.log.slice(-8).map((l, k) => (
            <g key={k} className="pdf-pop">
              <text x={18 + Math.floor(k / 4) * 290} y={236 + (k % 4) * 26} fontSize={10.5} fontFamily="var(--f-mono)" fontWeight={700} style={{ fill: l.tone === 'accent' ? 'var(--ink)' : stroke(l.tone) }}>
                {l.ply}. {l.side} {l.move}
              </text>
              <text x={18 + Math.floor(k / 4) * 290} y={249 + (k % 4) * 26} fontSize={9.5} className="pdf-muted">
                {l.note}
              </text>
            </g>
          ))}
        </Panel>
      </svg>
    </VizFrame>
  );
}
