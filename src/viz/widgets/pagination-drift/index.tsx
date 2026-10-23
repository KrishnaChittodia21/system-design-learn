import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { PAGE, cursorFor, simulate, type Frame, type Mode, type Params } from './sim';

const PER_ROW = 12;
const PITCH = 48;
const CW = 43;
const CH = 22;
const ROW = 27;
const TX = 8;
const TY = 46;
const FY = 206;
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

function Drawing({ f, mode }: { f: Frame; mode: Mode }) {
  // show a just-deleted row as a ghost at its old position
  const rows = f.deleted !== null ? [...f.table, f.deleted].sort((a, b) => b - a) : f.table;
  const scanned = new Set(f.scanned);
  const returned = new Set(f.returned);
  const inserted = new Set(f.inserted);
  const seenBefore = new Set(f.pages.slice(0, f.kind === 'fetch' ? -1 : undefined).flat());
  const dupSet = new Set(f.dups);
  const pos = (i: number) => ({ x: TX + (i % PER_ROW) * PITCH, y: TY + Math.floor(i / PER_ROW) * ROW });
  const curIdx = f.cursor === null ? -1 : rows.indexOf(f.cursor);
  const aria =
    `Server table newest first: ${f.table.length} rows. ` +
    (f.returned.length ? `Last fetch returned ${f.returned.map((i) => `#${i}`).join(', ')} after reading ${f.scanned.length} rows. ` : '') +
    `Pages received: ${f.pages.length}. Duplicates ${f.dups.length}. Skipped ${f.missed.length}.`;
  return (
    <svg viewBox="0 0 600 338" className="viz-svg" role="img" aria-label={aria}>
      <text x={8} y={16} fontSize={10.5} fontFamily="var(--f-mono)" style={{ fill: f.sql ? 'var(--accent)' : 'var(--text-2)' }}>
        {f.sql || (f.kind === 'write' ? '— other users are writing —' : ' ')}
      </text>
      <text x={8} y={36} style={{ fill: 'var(--text-2)' }} fontSize={10.5}>
        server table · ORDER BY created_at DESC, id DESC
      </text>
      {rows.map((id, i) => {
        const { x, y } = pos(i);
        const isDel = id === f.deleted;
        const ret = returned.has(id);
        const wasted = scanned.has(id) && !ret;
        const fill = isDel ? 'var(--bad-soft)' : ret ? 'var(--accent-soft)' : wasted ? 'var(--warn-soft)' : inserted.has(id) ? 'var(--good-soft)' : 'var(--surface)';
        const stroke = isDel ? 'var(--bad)' : ret ? 'var(--accent)' : wasted ? 'var(--warn)' : inserted.has(id) ? 'var(--good)' : 'var(--border-strong)';
        return (
          <g key={id} style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 0.45s ease' }} opacity={isDel ? 0.75 : 1}>
            <rect width={CW} height={CH} rx={5} fill={fill} stroke={stroke} strokeWidth={ret || inserted.has(id) ? 1.8 : 1.1} strokeDasharray={isDel ? '3 2' : undefined} />
            <text x={CW / 2} y={15} textAnchor="middle" fontSize={10.5} fontWeight={ret ? 700 : 500} style={{ textDecoration: isDel ? 'line-through' : undefined }}>
              #{id}
            </text>
            {seenBefore.has(id) && !isDel && <circle cx={CW - 4} cy={4} r={2.6} fill="var(--text-2)" />}
          </g>
        );
      })}
      {mode === 'cursor' && curIdx >= 0 && (
        <g style={{ transform: `translate(${pos(curIdx).x + CW + 2}px, ${pos(curIdx).y - 3}px)`, transition: 'transform 0.45s ease' }}>
          <rect width={3} height={CH + 6} rx={1.5} fill="var(--mag)" />
        </g>
      )}
      {f.kind === 'fetch' && mode === 'offset' && f.scanned.length > f.returned.length && (
        <text x={8} y={TY + Math.ceil(rows.length / PER_ROW) * ROW + 10} fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)' }}>
          {f.scanned.length - f.returned.length} rows read and thrown away to reach OFFSET {f.scanned.length - f.returned.length}
        </text>
      )}
      {mode === 'cursor' && f.cursor !== null && (
        <text x={8} y={TY + Math.ceil(rows.length / PER_ROW) * ROW + 10} fontSize={10} fontWeight={700} style={{ fill: 'var(--mag)' }}>
          ▍cursor "{cursorFor(f.cursor)}" = after #{f.cursor} — anchored to a row, not a position
        </text>
      )}

      {/* client */}
      <text x={8} y={FY - 8} style={{ fill: 'var(--text-2)' }} fontSize={10.5}>
        what the client has shown
      </text>
      {f.pages.map((p, n) => (
        <g key={n}>
          <text x={8} y={FY + n * ROW + 15} fontSize={10.5} fontWeight={700}>
            p{n + 1}
          </text>
          {p.map((id, k) => {
            const firstIdx = f.pages.flat().indexOf(id);
            const flatIdx = f.pages.slice(0, n).flat().length + k;
            const dup = dupSet.has(id) && firstIdx < flatIdx;
            return (
              <g key={id}>
                <rect x={32 + k * PITCH} y={FY + n * ROW} width={CW} height={CH} rx={5} fill={dup ? 'var(--bad-soft)' : 'var(--accent-soft)'} stroke={dup ? 'var(--bad)' : 'var(--accent)'} strokeWidth={dup ? 2 : 1.1} />
                <text x={32 + k * PITCH + CW / 2} y={FY + n * ROW + 15} textAnchor="middle" fontSize={10.5} fontWeight={dup ? 800 : 500}>
                  #{id}
                </text>
              </g>
            );
          })}
        </g>
      ))}
      <g>
        <rect x={290} y={FY - 2} width={306} height={4 * ROW} rx={10} fill="var(--surface)" stroke="var(--border)" />
        <text x={302} y={FY + 18} fontSize={11.5} fontWeight={700}>
          rows read by the DB: {f.totalScanned} for {f.pages.length * PAGE} delivered
        </text>
        <text x={302} y={FY + 44} fontSize={11.5} fontWeight={700} style={{ fill: f.dups.length ? 'var(--bad)' : 'var(--good)' }}>
          duplicates shown: {f.dups.length}
          {f.dups.length ? ` (${f.dups.map((i) => `#${i}`).join(' ')})` : ''}
        </text>
        <text x={302} y={FY + 70} fontSize={11.5} fontWeight={700} style={{ fill: f.missed.length ? 'var(--bad)' : 'var(--good)' }}>
          skipped forever: {f.missed.length}
          {f.missed.length ? ` (${f.missed.map((i) => `#${i}`).join(' ')})` : ''}
        </text>
        <text x={302} y={FY + 94} fontSize={10} style={{ fill: 'var(--text-2)', ...halo }}>
          {mode === 'offset' ? 'cost per page grows with offset' : `cost per page: always limit + 1 = ${PAGE + 1} rows`}
        </text>
      </g>
    </svg>
  );
}

export default function PaginationDriftViz() {
  const [params, setParams] = useState<Params>({ mode: 'offset', inserts: 2, del: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Mode>
            label="Pagination"
            value={params.mode}
            options={[
              { value: 'offset', label: 'Offset / limit' },
              { value: 'cursor', label: 'Cursor (keyset)' },
            ]}
            onChange={(mode) => setParams((p) => ({ ...p, mode }))}
          />
          <Slider label="New posts between pages" value={params.inserts} min={0} max={3} onChange={(inserts) => setParams((p) => ({ ...p, inserts }))} />
          <Choice<'no' | 'yes'>
            label="A seen post is deleted"
            value={params.del ? 'yes' : 'no'}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes, before page 3' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, del: v === 'yes' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> returned this page
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> read then discarded (offset)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> just inserted
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> duplicate / deleted
          <span className="viz-key" style={{ background: 'var(--mag)', borderRadius: 2 }} /> cursor position
          <span className="viz-key" style={{ background: 'var(--text-2)' }} /> already shown
        </>
      }
    >
      <Drawing f={stepper.frame} mode={params.mode} />
    </VizFrame>
  );
}
