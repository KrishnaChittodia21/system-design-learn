import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type BlockState, type Chunking, type Edit, type Params } from './sim';

const X0 = 86;
const CW = 5.3;
const ROW_Y = (r: number) => 30 + r * 50;
const BLOCK_H = 36;

const STATE: Record<BlockState, { fill: string; stroke: string; ink: string; label: string }> = {
  upload: { fill: 'var(--accent)', stroke: 'var(--accent)', ink: 'var(--surface)', label: 'new block, uploaded' },
  dedup: { fill: 'var(--good-soft)', stroke: 'var(--good)', ink: 'var(--text)', label: 'hash already on server, skipped' },
  download: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', ink: 'var(--text)', label: 'downloaded' },
  local: { fill: 'var(--surface)', stroke: 'var(--border)', ink: 'var(--text-2)', label: 'already on this disk' },
};

const nbsp = (s: string) => s.replace(/ /g, ' ');

export default function DropboxChunkSyncViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const aria = `${f.rows.length} block lists shown. Block store holds ${f.store.length} unique blocks. Uploaded ${f.up} bytes, downloaded ${f.down} bytes, whole-file sync would have moved ${f.naive}.${f.status ? ` ${f.status.text}.` : ''}`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Chunking>
            label="Chunking"
            value={params.chunking}
            options={[
              { value: 'fixed', label: 'Fixed 8-byte blocks' },
              { value: 'cdc', label: 'Content-defined' },
            ]}
            onChange={(chunking) => setParams((p) => ({ ...p, chunking }))}
          />
          <Choice<Edit>
            label="A's edit"
            value={params.edit}
            options={[
              { value: 'insert', label: 'Insert at start' },
              { value: 'overwrite', label: 'Overwrite in middle' },
            ]}
            onChange={(edit) => setParams((p) => ({ ...p, edit }))}
          />
        </>
      }
      legend={
        <>
          {(Object.keys(STATE) as BlockState[]).map((s) => (
            <span key={s}>
              <span className="viz-key" style={{ marginRight: 4, background: STATE[s].fill, border: `1px solid ${STATE[s].stroke}` }} /> {STATE[s].label}
            </span>
          ))}
        </>
      }
    >
      <svg viewBox="0 0 600 334" className="viz-svg" role="img" aria-label={aria}>
        <text x={8} y={16} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          blocks (text, then content hash)
        </text>
        {f.status && (
          <text x={592} y={16} textAnchor="end" fontSize={11} fontWeight={700} style={{ fill: `var(--${f.status.tone})` }}>
            {f.status.text}
          </text>
        )}

        {f.rows.map((r, ri) => {
          const y = ROW_Y(ri);
          const active = ri === f.active;
          let x = X0;
          return (
            <g key={ri}>
              {active && <rect x={4} y={y - 4} width={592} height={BLOCK_H + 8} rx={8} fill="var(--accent-soft)" />}
              <text x={10} y={y + 15} fontSize={11} fontWeight={700}>
                {r.label.split(' · ')[0]}
              </text>
              <text x={10} y={y + 29} className="viz-label" style={{ fontSize: 9.5 }}>
                {r.label.split(' · ')[1]}
              </text>
              {r.blocks.map((b, bi) => {
                const w = b.text.length * CW;
                const bx = x;
                x += w;
                const st = STATE[b.state];
                const clip = `dcs-clip-${ri}-${bi}`;
                return (
                  <g key={bi}>
                    <clipPath id={clip}>
                      <rect x={bx + 1} y={y} width={Math.max(0, w - 2.5)} height={BLOCK_H} />
                    </clipPath>
                    <rect x={bx + 0.75} y={y} width={w - 1.5} height={BLOCK_H} rx={4} fill={st.fill} stroke={st.stroke} strokeWidth={1.2} style={{ transition: 'fill 0.3s ease' }} />
                    <text x={bx + 2} y={y + 14} fontSize={8.4} fontFamily="var(--f-mono)" clipPath={`url(#${clip})`} style={{ fill: st.ink }}>
                      {nbsp(b.text)}
                    </text>
                    <text x={bx + 2} y={y + 29} fontSize={8} fontFamily="var(--f-mono)" fontWeight={700} style={{ fill: st.ink, opacity: 0.8 }}>
                      {w > 22 ? b.hash : b.hash.slice(0, 2)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* panels */}
        {[
          { x: 8, title: 'block store (by hash)' },
          { x: 204, title: 'metadata DB: file versions' },
          { x: 400, title: 'devices & bytes moved' },
        ].map((p) => (
          <g key={p.x}>
            <rect x={p.x} y={236} width={188} height={92} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
            <text x={p.x + 8} y={252} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
              {p.title}
            </text>
          </g>
        ))}
        <text x={16} y={276} fontSize={20} fontWeight={700}>
          {f.store.length}
          <tspan fontSize={11} fontWeight={400} dx={4}>
            unique blocks
          </tspan>
        </text>
        <text x={16} y={296} className="viz-label" style={{ fontSize: 10.5 }}>
          {f.storeBytes} bytes stored once
        </text>
        <text x={16} y={314} className="viz-label" style={{ fontSize: 10.5 }}>
          GC'd once no version uses them
        </text>

        {f.versions.length === 0 && (
          <text x={212} y={272} fontSize={10.5} style={{ fill: 'var(--muted)' }}>
            nothing committed
          </text>
        )}
        {f.versions.map((v, i) => (
          <text key={i} x={212} y={272 + i * 17} fontSize={10.5}>
            <tspan fontWeight={700}>{v.name.replace('.txt', '')}</tspan> v{v.version}
          </text>
        ))}

        <text x={408} y={272} fontSize={10.5}>
          A: <tspan fontWeight={700}>{f.devA}</tspan>
        </text>
        <text x={408} y={288} fontSize={10.5}>
          B: <tspan fontWeight={700}>{f.devB}</tspan>
        </text>
        <text x={408} y={306} fontSize={10.5}>
          ↑ {f.up} B · ↓ {f.down} B
        </text>
        <text x={408} y={321} className="viz-label" style={{ fontSize: 10 }}>
          whole-file sync: {f.naive} B
        </text>
      </svg>
    </VizFrame>
  );
}
