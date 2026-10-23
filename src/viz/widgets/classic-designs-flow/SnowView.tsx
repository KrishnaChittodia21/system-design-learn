import { useState, type ReactNode } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { EPOCH, bits64, decodeId, simulateSnowflake, type ClockJump, type SnowParams } from './sim';
import { soft, stroke } from './tones';
import type { Tone } from './sim';

const GROUPS: { name: string; from: number; len: number; tone: Tone }[] = [
  { name: 'sign', from: 0, len: 1, tone: 'muted' },
  { name: 'timestamp: ms since epoch (41 bits)', from: 1, len: 41, tone: 'accent' },
  { name: 'dc', from: 42, len: 5, tone: 'warn' },
  { name: 'worker', from: 47, len: 5, tone: 'mag' },
  { name: 'sequence (12 bits)', from: 52, len: 12, tone: 'good' },
];
const BX = 24;
const BW = 8.6;

const clockText = (ms: bigint) => new Date(Number(ms)).toISOString().slice(11, 23);

export default function SnowView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<SnowParams>({ dc: 3, worker: 17, jump: 'small' });
  const frames = useSimulation(simulateSnowflake, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const bits = f.cur ? bits64(f.cur.id) : '0'.repeat(64);
  const d = f.cur ? decodeId(f.cur.id) : null;

  const nodes: Record<string, NodeDef> = {
    app: { id: 'app', label: 'App servers', sub: 'need ids', x: 8, y: 16, w: 112, h: 46 },
    gen: { id: 'gen', label: `Generator dc ${params.dc} · w ${params.worker}`, sub: f.refused ? 'REFUSING (clock behind)' : 'in-process, no network', x: 196, y: 16, w: 176, h: 46 },
    ntp: { id: 'ntp', label: 'System clock', sub: 'NTP / chrony', x: 452, y: 8, w: 140, h: 40 },
    zk: { id: 'zk', label: 'etcd / ZooKeeper', sub: 'worker-id lease', x: 452, y: 56, w: 140, h: 40 },
  };
  const values = d
    ? [0, Number(d.ms - EPOCH), d.dc, d.worker, d.seq]
    : [0, 0, 0, 0, 0];
  const aria = f.cur ? `Current id ${f.cur.id}: timestamp ${clockText(f.cur.ms)}, datacenter ${f.cur.dc}, worker ${f.cur.worker}, sequence ${f.cur.seq}.` : 'No id generated yet.';

  return (
    <VizFrame
      title="Snowflake IDs: 64 bits of time, place and sequence"
      blurb="Watch each id assemble from its bit fields, push the sequence past 4,095 inside one millisecond, then step the clock backwards. Change the datacenter and worker bits to see which part of the id they own."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Slider label="Datacenter id (5 bits)" value={params.dc} min={0} max={31} onChange={(dc) => setParams((p) => ({ ...p, dc }))} />
          <Slider label="Worker id (5 bits)" value={params.worker} min={0} max={31} onChange={(worker) => setParams((p) => ({ ...p, worker }))} />
          <Choice<ClockJump>
            label="Clock jumps back"
            value={params.jump}
            options={[
              { value: 'small', label: '3 ms (wait)' },
              { value: 'large', label: '20 ms (refuse)' },
            ]}
            onChange={(jump) => setParams((p) => ({ ...p, jump }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> timestamp bits
          <Key tone="warn" /> datacenter
          <Key tone="mag" /> worker
          <Key tone="good" /> sequence
          <Key tone="bad" /> clock problem
        </>
      }
    >
      <svg viewBox="0 0 600 336" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        <Edge a={nodes.app} b={nodes.gen} dashed />
        <Edge a={nodes.ntp} b={nodes.gen} dashed />
        <Edge a={nodes.zk} b={nodes.gen} dashed />
        {Object.values(nodes).map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} packet k={`${stepper.i}-${k}`} />
        ))}
        <text x={196} y={80} fontSize={10} className="cdf-muted">
          clock {clockText(f.clock)} · last stamp {f.last >= 0n ? clockText(f.last) : '–'}
        </text>

        {/* bit layout */}
        {GROUPS.map((g, gi) => {
          const x = BX + g.from * BW;
          const w = g.len * BW;
          return (
            <g key={g.name}>
              <text x={x + w / 2} y={112} textAnchor="middle" fontSize={g.len < 6 ? 9.5 : 10.5} fontWeight={700} style={{ fill: stroke(g.tone) }}>
                {g.len === 1 ? '0' : g.name}
              </text>
              <text x={x + w / 2} y={168} textAnchor="middle" fontSize={10.5} fontWeight={800}>
                {g.len === 1 ? '' : values[gi].toLocaleString('en-US')}
              </text>
            </g>
          );
        })}
        {bits.split('').map((b, i) => {
          const g = GROUPS.find((x) => i >= x.from && i < x.from + x.len)!;
          return (
            <rect
              key={i}
              x={BX + i * BW + 0.6}
              y={120}
              width={BW - 1.2}
              height={30}
              rx={2}
              fill={b === '1' ? stroke(g.tone) : soft(g.tone)}
              stroke={stroke(g.tone)}
              strokeWidth={0.6}
              style={{ transition: 'fill 0.3s ease' }}
            >
              <title>{`bit ${63 - i}: ${b}`}</title>
            </rect>
          );
        })}
        <text x={BX} y={182} fontSize={10} className="cdf-muted">
          filled = 1, hollow = 0 · most significant bit on the left
        </text>
        {f.cur && (
          <text x={576} y={182} fontSize={11} fontWeight={800} textAnchor="end">
            id = {f.cur.id.toString()}
          </text>
        )}

        {/* generated id log */}
        <Panel x={8} y={194} w={584} h={138} title="Ids issued (newest last), always increasing">
          {f.log.length === 0 && (
            <text x={18} y={226} fontSize={10.5} className="cdf-muted">
              none yet
            </text>
          )}
          {f.log.map((l, k) => {
            const dd = decodeId(l.id);
            const prev = k > 0 ? f.log[k - 1].id : null;
            return (
              <g key={`${l.id}-${k}`} className="cdf-pop">
                <text x={18} y={230 + k * 17} fontSize={10.5} fontWeight={700} fontFamily="var(--f-mono)">
                  {l.id.toString()}
                </text>
                <text x={190} y={230 + k * 17} fontSize={10} className="cdf-muted" fontFamily="var(--f-mono)">
                  {clockText(dd.ms)} · seq {dd.seq}
                </text>
                {prev !== null && (
                  <text x={360} y={230 + k * 17} fontSize={10} className="cdf-muted">
                    {l.id > prev ? `+${(l.id - prev).toLocaleString('en-US')}` : 'not increasing!'}
                  </text>
                )}
                <Pill x={582} y={227 + k * 17} text={l.note} tone={l.tone} anchor="end" size={9} />
              </g>
            );
          })}
        </Panel>
      </svg>
    </VizFrame>
  );
}
