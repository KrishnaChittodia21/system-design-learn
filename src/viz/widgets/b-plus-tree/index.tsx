import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, RANGE_HI, RANGE_LO, simulate, type KeyOrder, type KeyTone, type Params, type SnapNode, type Tone } from './sim';

const TOP = 34;
const LEVEL_GAP = 66;
const NODE_H = 26;
const GAP = 14;
const LEFT = 10;
const WIDTH = 580;

const NODE_STYLE: Record<Tone, { fill: string; stroke: string }> = {
  path: { fill: 'var(--accent-soft)', stroke: 'var(--accent)' },
  overflow: { fill: 'var(--bad-soft)', stroke: 'var(--bad)' },
  split: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  new: { fill: 'var(--accent-soft)', stroke: 'var(--accent)' },
  scan: { fill: 'var(--good-soft)', stroke: 'var(--good)' },
  visit: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  done: { fill: 'var(--surface-2)', stroke: 'var(--border)' },
};

const KEY_STYLE: Record<KeyTone, { fill: string; text: string }> = {
  inserted: { fill: 'var(--accent)', text: 'var(--surface)' },
  copied: { fill: 'var(--good)', text: 'var(--surface)' },
  pushed: { fill: 'var(--warn)', text: 'var(--surface)' },
  hit: { fill: 'var(--good)', text: 'var(--surface)' },
  miss: { fill: 'var(--muted)', text: 'var(--surface)' },
};

interface Placed {
  node: SnapNode;
  x: number;
  y: number;
  w: number;
  cells: number;
}

/** leaves left→right with fixed widths; parents centred over their children */
function layout(root: SnapNode, m: number): { placed: Placed[]; cellW: number } {
  const leaves: SnapNode[] = [];
  const collect = (n: SnapNode) => (n.children.length ? n.children.forEach(collect) : leaves.push(n));
  collect(root);
  const cellsOf = (n: SnapNode) => Math.max(m, n.keys.length);
  const totalCells = leaves.reduce((a, l) => a + cellsOf(l), 0);
  const cellW = Math.min(30, (WIDTH - GAP * (leaves.length - 1)) / totalCells);
  const placed: Placed[] = [];
  let cursor = LEFT + (WIDTH - (totalCells * cellW + GAP * (leaves.length - 1))) / 2;
  const place = (n: SnapNode, depth: number): Placed => {
    const cells = cellsOf(n);
    const w = cells * cellW;
    let x: number;
    if (!n.children.length) {
      x = cursor;
      cursor += w + GAP;
    } else {
      const kids = n.children.map((c) => place(c, depth + 1));
      const mid = (kids[0].x + kids[kids.length - 1].x + kids[kids.length - 1].w) / 2;
      x = Math.max(LEFT, Math.min(LEFT + WIDTH - w, mid - w / 2));
    }
    const p = { node: n, x, y: TOP + depth * LEVEL_GAP, w, cells };
    placed.push(p);
    return p;
  };
  place(root, 0);
  return { placed, cellW };
}

export default function BPlusTreeViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const m = params.maxKeys;

  const lay = f.tree ? layout(f.tree, m) : null;
  const byId = new Map(lay?.placed.map((p) => [p.node.id, p]) ?? []);
  const leaves = lay ? lay.placed.filter((p) => !p.node.children.length).sort((a, b) => a.x - b.x) : [];
  const leafY = leaves[0]?.y ?? TOP;
  const infoY = Math.max(leafY + NODE_H + 40, 236);
  const isB = f.kind === 'btree';

  const aria = f.tree
    ? `${isB ? 'B-tree' : 'B+ tree'} of height ${f.stats.height} with ${f.stats.nodes} nodes (${f.stats.leaves} leaves). Leaves: ${leaves
        .map((l) => `[${l.node.keys.join(' ')}]`)
        .join(' ')}.${f.found.length ? ` Range result so far: ${f.found.join(', ')}.` : ''}`
    : 'Empty tree.';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Max keys per node" value={m} min={3} max={5} onChange={(v) => setParams((p) => ({ ...p, maxKeys: v }))} />
          <Choice<KeyOrder>
            label="Insert order"
            value={params.keyOrder}
            options={[
              { value: 'sequential', label: 'Sequential (5, 10, 15…)' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, keyOrder: v }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> new key / search path
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> overflow
          <span className="viz-key" style={{ background: 'var(--good)' }} /> copied up (leaf split) / in range
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> moved up (internal split) / B-tree visit
        </>
      }
    >
      <svg viewBox="0 0 600 300" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="bpt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
          <marker id="bpt-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--good)" />
          </marker>
        </defs>
        <text x={8} y={16} className="viz-label">
          {isB ? 'classic B-tree (keys stored once, no leaf links)' : `B+ tree, max ${m} keys/node`}
          {f.tree ? ` · height ${f.stats.height} · ${f.stats.nodes} nodes (${f.stats.internal} internal, ${f.stats.leaves} leaves)` : ''}
        </text>
        {!f.tree && (
          <text x={300} y={140} textAnchor="middle" className="viz-label">
            empty: the first insert creates a leaf that is also the root
          </text>
        )}

        {/* child pointers */}
        {lay?.placed.map((p) =>
          p.node.children.map((c, i) => {
            const cp = byId.get(c.id)!;
            const px = p.x + Math.min(i, p.node.keys.length) * lay.cellW + (i === 0 ? 2 : 0);
            return <line key={`${p.node.id}-${c.id}`} x1={px} y1={p.y + NODE_H} x2={cp.x + cp.w / 2} y2={cp.y} stroke="var(--border)" strokeWidth={1.4} />;
          }),
        )}

        {/* leaf sibling links */}
        {f.showLinks &&
          leaves.map((l) => {
            if (!l.node.next) return null;
            const n = byId.get(l.node.next);
            if (!n) return null;
            const hot = f.linkHl === l.node.id;
            return (
              <line
                key={`lk-${l.node.id}`}
                x1={l.x + l.w + 1}
                y1={l.y + NODE_H / 2}
                x2={n.x - 1}
                y2={n.y + NODE_H / 2}
                stroke={hot ? 'var(--good)' : 'var(--muted)'}
                strokeWidth={hot ? 2.5 : 1.3}
                markerEnd={hot ? 'url(#bpt-arrow-hot)' : 'url(#bpt-arrow)'}
              />
            );
          })}

        {/* nodes */}
        {lay?.placed.map((p) => {
          const tone = f.hl[p.node.id];
          const st = tone ? NODE_STYLE[tone] : { fill: 'var(--surface-2)', stroke: 'var(--border)' };
          const cw = lay.cellW;
          return (
            <g key={p.node.id}>
              <rect
                x={p.x}
                y={p.y}
                width={p.w}
                height={NODE_H}
                rx={4}
                fill={st.fill}
                stroke={st.stroke}
                strokeWidth={tone ? 2.2 : 1.2}
                style={{ transition: 'x 0.35s ease, y 0.35s ease, fill 0.3s ease' }}
              />
              {Array.from({ length: p.cells }, (_, i) => {
                const k = p.node.keys[i];
                const kt = k !== undefined ? f.keyHl[`${p.node.id}:${k}`] : undefined;
                const over = i >= m;
                return (
                  <g key={i}>
                    {i > 0 && <line x1={p.x + i * cw} y1={p.y + 3} x2={p.x + i * cw} y2={p.y + NODE_H - 3} stroke="var(--border)" />}
                    {kt && <rect x={p.x + i * cw + 2} y={p.y + 3} width={cw - 4} height={NODE_H - 6} rx={3} fill={KEY_STYLE[kt].fill} />}
                    {over && !kt && <rect x={p.x + i * cw + 2} y={p.y + 3} width={cw - 4} height={NODE_H - 6} rx={3} fill="var(--bad-soft)" />}
                    {k !== undefined && (
                      <text
                        x={p.x + i * cw + cw / 2}
                        y={p.y + NODE_H / 2 + 4}
                        textAnchor="middle"
                        fontSize={Math.min(12, cw * 0.48)}
                        fontWeight={p.node.children.length ? 700 : 500}
                        style={{
                          fill: kt ? KEY_STYLE[kt].text : p.node.children.length ? 'var(--accent)' : 'var(--text)',
                          fontFamily: 'var(--mono)',
                          textDecoration: kt === 'miss' ? 'line-through' : undefined,
                        }}
                      >
                        {k}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* level labels */}
        {f.tree && (
          <>
            {!isB && leaves.length > 0 && (
              <text x={8} y={leafY + NODE_H + 16} className="viz-label">
                leaves hold every key{f.showLinks ? ' · arrows = sibling links' : ''}
              </text>
            )}
          </>
        )}

        {/* range / result strip */}
        <text x={8} y={infoY} fontSize={12} fontWeight={600}>
          {f.phase === 'scan' || f.phase === 'btree' || (f.phase === 'done' && f.found.length)
            ? `range ${RANGE_LO} ≤ k ≤ ${RANGE_HI} → `
            : `inserted (${f.inserted.length}): `}
        </text>
        {(f.phase === 'scan' || f.phase === 'btree' || (f.phase === 'done' && f.found.length) ? f.found : f.inserted).map((k, i, arr) => {
          const last = i === arr.length - 1 && (f.phase === 'insert' || f.phase === 'overflow');
          return (
            <g key={`${k}-${i}`}>
              <rect
                x={150 + i * 31}
                y={infoY - 14}
                width={27}
                height={19}
                rx={4}
                fill={last ? 'var(--accent)' : f.phase === 'scan' || f.phase === 'btree' || f.phase === 'done' ? 'var(--good-soft)' : 'var(--surface-2)'}
                stroke="var(--border)"
              />
              <text x={150 + i * 31 + 13.5} y={infoY} textAnchor="middle" fontSize={11} style={{ fill: last ? 'var(--surface)' : 'var(--text)', fontFamily: 'var(--mono)' }}>
                {k}
              </text>
            </g>
          );
        })}
        <text x={8} y={infoY + 26} className="viz-label">
          {isB
            ? 'B-tree: keys live in internal nodes too, so an in-order range scan climbs back up between children.'
            : 'B+ tree: internal nodes are signposts (copies); a range scan descends once, then walks leaves left → right.'}
        </text>
      </svg>
    </VizFrame>
  );
}
