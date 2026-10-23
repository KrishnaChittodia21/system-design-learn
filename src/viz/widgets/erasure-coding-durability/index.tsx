import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { NODES, OBJECT_MB, overheadPct, rawMB, readFanout, schemeInfo, simulate, type Params, type Scheme } from './sim';

const RACKS = 4;
const PER_RACK = NODES / RACKS;

export default function ErasureCodingViz() {
  const [params, setParams] = useState<Params>({ scheme: 'ec8+4', repair: false, seed: 1 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const info = schemeInfo(params.scheme);
  const n = info.k + info.m;

  const RW = 122;
  const RX = (r: number) => 8 + r * (RW + 7);
  const NY = (i: number) => 44 + i * 36;
  const chunkOn = (node: number) => f.chunks.find((c) => c.node === node);

  // meters
  const MX = 140;
  const MW = 370;
  const maxRaw = 3 * OBJECT_MB;
  const bar = (v: number, max: number) => (v / max) * MW;

  const aria = `${info.label}: ${f.alive} of ${n} chunks alive, ${info.k} needed. ${f.lost ? 'Object lost.' : f.readable ? 'Object readable.' : ''} Failed nodes: ${f.deadNodes.map((d) => d + 1).join(', ') || 'none'}. Repair traffic ${f.repairMB} MB.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scheme>
            label="Scheme"
            value={params.scheme}
            options={[
              { value: 'rep3', label: '3× replication' },
              { value: 'ec4+2', label: 'EC 4+2' },
              { value: 'ec8+4', label: 'EC 8+4' },
            ]}
            onChange={(scheme) => setParams((p) => ({ ...p, scheme }))}
          />
          <Choice<'off' | 'on'>
            label="Repair between failures"
            value={params.repair ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'no (failures overlap)' },
              { value: 'on', label: 'yes' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, repair: v === 'on' }))}
          />
          <Choice<string>
            label="Failure order"
            value={String(params.seed)}
            options={['1', '2', '3'].map((v) => ({ value: v, label: `#${v}` }))}
            onChange={(v) => setParams((p) => ({ ...p, seed: Number(v) }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> data chunk / copy
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> parity chunk
          <span className="viz-key" style={{ background: 'var(--good)' }} /> rebuilt by repair
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> failed node
        </>
      }
    >
      <svg viewBox="0 0 520 290" className="viz-svg" role="img" aria-label={aria}>
        {Array.from({ length: RACKS }, (_, r) => (
          <g key={r}>
            <rect x={RX(r)} y={8} width={RW} height={182} rx={10} fill="none" stroke="var(--border)" strokeDasharray="4 3" />
            <text x={RX(r) + RW / 2} y={30} textAnchor="middle" fontSize={10.5} className="viz-label">
              rack {r + 1}
            </text>
            {Array.from({ length: PER_RACK }, (_, i) => {
              const node = r * PER_RACK + i;
              const dead = f.deadNodes.includes(node);
              const c = chunkOn(node);
              const just = f.justFailed === node;
              const color = c ? (c.rebuilt ? 'var(--good)' : c.parity ? 'var(--warn)' : 'var(--accent)') : 'var(--border)';
              return (
                <g key={node}>
                  <rect
                    x={RX(r) + 8}
                    y={NY(i)}
                    width={RW - 16}
                    height={30}
                    rx={7}
                    fill={dead ? 'var(--bad-soft)' : c ? 'var(--surface)' : 'transparent'}
                    stroke={dead ? 'var(--bad)' : 'var(--border-strong)'}
                    strokeWidth={just ? 3 : 1}
                    style={{ transition: 'fill .3s, stroke .3s' }}
                  />
                  <text x={RX(r) + 16} y={NY(i) + 19} fontSize={10} className="viz-label">
                    n{node + 1}
                  </text>
                  {c && (
                    <g opacity={c.alive ? 1 : 0.45}>
                      <rect x={RX(r) + 44} y={NY(i) + 6} width={RW - 60} height={18} rx={5} fill={color} fillOpacity={c.alive ? 0.25 : 0.1} stroke={color} strokeDasharray={c.alive ? undefined : '3 2'} />
                      <text x={RX(r) + 44 + (RW - 60) / 2} y={NY(i) + 19} textAnchor="middle" fontSize={10.5} fontWeight={700} textDecoration={c.alive ? undefined : 'line-through'}>
                        {c.name}
                      </text>
                    </g>
                  )}
                  {dead && (
                    <text x={RX(r) + RW - 12} y={NY(i) + 19} textAnchor="end" fontSize={12} fontWeight={700} style={{ fill: 'var(--bad)' }}>
                      ✕
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {/* chunks alive vs needed */}
        <text x={8} y={214} fontSize={10.5} fontWeight={600}>
          chunks alive
        </text>
        <rect x={MX} y={204} width={MW} height={12} rx={4} fill="var(--tint-2)" />
        <rect x={MX} y={204} width={(f.alive / n) * MW} height={12} rx={4} fill={f.lost ? 'var(--bad)' : f.alive === info.k ? 'var(--warn)' : 'var(--good)'} style={{ transition: 'width .35s, fill .35s' }} />
        <line x1={MX + (info.k / n) * MW} x2={MX + (info.k / n) * MW} y1={199} y2={221} stroke="var(--text)" strokeWidth={2} />
        <text x={MX + (info.k / n) * MW} y={232} textAnchor="middle" fontSize={9.5} className="viz-label">
          need {info.k}
        </text>
        <text x={MX + MW} y={198} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: f.lost ? 'var(--bad)' : 'var(--text)' }}>
          {f.alive}/{n} {f.lost ? '· LOST' : ''}
        </text>

        {/* storage */}
        <text x={8} y={252} fontSize={10.5} fontWeight={600}>
          raw storage
        </text>
        <rect x={MX} y={243} width={bar(maxRaw, maxRaw)} height={12} rx={4} fill="var(--tint-2)" />
        <rect x={MX} y={243} width={bar(OBJECT_MB, maxRaw)} height={12} rx={4} fill="var(--accent)" opacity={0.85} />
        <rect x={MX + bar(OBJECT_MB, maxRaw)} y={243} width={bar(rawMB(params.scheme) - OBJECT_MB, maxRaw)} height={12} fill="var(--warn)" opacity={0.7} />
        <text x={MX + MW} y={270} textAnchor="end" fontSize={10} className="viz-label">
          {rawMB(params.scheme)} MB for {OBJECT_MB} MB (+{overheadPct(params.scheme)}%) · read fan-out {readFanout(params.scheme)}
        </text>

        <text x={8} y={286} fontSize={10.5} fontWeight={600}>
          repair traffic {f.repairMB} MB
        </text>
        <text x={MX + MW} y={286} textAnchor="end" fontSize={10} className="viz-label">
          {info.nines ? `${info.nines} · ` : ''}survives any {info.m} overlapping failures
        </text>
      </svg>
    </VizFrame>
  );
}
