import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DIFF_LIMIT, MODULES, ROUTES, SLICES, servicePath, simulate, type ModuleState, type Params, type Slice } from './sim';

const STATE_STYLE: Record<ModuleState, { fill: string; stroke: string; label: string }> = {
  mono: { fill: 'var(--surface)', stroke: 'var(--border-strong)', label: '' },
  seam: { fill: 'var(--accent-soft)', stroke: 'var(--accent)', label: 'own schema' },
  shared: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', label: 'shared tables' },
  dual: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'fallback' },
  extracted: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'still called' },
  deleted: { fill: 'transparent', stroke: 'var(--border)', label: 'deleted' },
};

const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

export default function StranglerFigViz() {
  const [params, setParams] = useState<Params>({ slice: 'pricing', bug: true });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const slice = params.slice;
  const info = SLICES[slice];

  // layout
  const FX = 96;
  const FW = 168;
  const MX = 296;
  const MW = 214;
  const routeY = (i: number) => 74 + i * 34;
  const sliceIdx = MODULES.indexOf(slice);
  const modY = (i: number) => 46 + Math.floor(i / 2) * 30;
  const modX = (i: number) => MX + 10 + (i % 2) * 100;
  const SVC_Y = 176;
  const DB_Y = 262;
  const monoW = 100 - f.split;
  const svcW = f.split;

  const aria =
    `${f.facade ? 'Facade in front of the monolith. ' : 'No facade yet. '}` +
    `${ROUTES[slice]}: ${svcW}% to ${slice} service, ${monoW}% to monolith.` +
    `${f.shadow ? ` Shadow traffic mirrored, diff rate ${f.diffRate}%.` : ''}` +
    ` Data owner: ${f.owner === 'svc' ? `${slice} service` : 'monolith'}. CDC ${f.cdc === 'none' ? 'off' : f.cdc === 'mono-to-svc' ? 'monolith to service' : 'service to monolith'}.` +
    ` Route latency ${f.ms} ms, availability ${(f.availability * 100).toFixed(2)}%.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Slice>
            label="First slice"
            value={params.slice}
            options={[
              { value: 'pricing', label: 'pricing' },
              { value: 'search', label: 'search' },
              { value: 'checkout', label: 'checkout (core)' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, slice: v }))}
          />
          <Choice<'bug' | 'clean'>
            label="New service"
            value={params.bug ? 'bug' : 'clean'}
            options={[
              { value: 'bug', label: 'has a rounding bug' },
              { value: 'clean', label: 'matches' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, bug: v === 'bug' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> new service / its traffic
          <span className="viz-key" style={{ background: 'var(--ink-4)' }} /> monolith traffic
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> migrating / still coupled
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> blocked / shared tables
        </>
      }
    >
      <svg viewBox="0 0 520 318" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="sfm-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-4)" />
          </marker>
          <marker id="sfm-arr-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* clients */}
        <rect x={6} y={140} width={64} height={40} rx={8} fill="var(--surface)" stroke="var(--border-strong)" />
        <text x={38} y={164} textAnchor="middle" fontSize={11} fontWeight={700}>
          clients
        </text>

        {/* facade */}
        {f.facade ? (
          <g>
            <rect x={FX} y={22} width={FW} height={222} rx={10} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.5} />
            <text x={FX + 10} y={40} fontSize={11} fontWeight={700} style={{ fill: 'var(--accent)' }}>
              facade / gateway
            </text>
            <text x={FX + 10} y={55} fontSize={9.5} className="viz-label">
              route → monolith | service
            </text>
            {MODULES.map((m, i) => {
              const y = routeY(i);
              const isSlice = i === sliceIdx;
              const w = FW - 20;
              const s = isSlice ? f.split : 0;
              return (
                <g key={m}>
                  <text x={FX + 10} y={y} fontSize={10.5} fontWeight={isSlice ? 700 : 500} fontFamily="var(--f-mono)">
                    {ROUTES[m]}
                  </text>
                  <rect x={FX + 10} y={y + 5} width={w} height={9} rx={3} fill="var(--ink-4)" opacity={0.45} />
                  <rect x={FX + 10 + w * (1 - s / 100)} y={y + 5} width={(w * s) / 100} height={9} rx={3} fill="var(--accent)" style={{ transition: 'x .4s, width .4s' }} />
                  {isSlice && (
                    <text x={FX + FW - 10} y={y} textAnchor="end" fontSize={10} fontWeight={700} style={{ fill: s ? 'var(--accent)' : 'var(--text-2)' }}>
                      {f.shadow && s === 0 ? 'mirror' : `${s}%`}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ) : (
          <g>
            <rect x={FX} y={22} width={FW} height={222} rx={10} fill="none" stroke="var(--border)" strokeDasharray="5 4" />
            <text x={FX + FW / 2} y={214} textAnchor="middle" fontSize={11} className="viz-label">
              no facade yet
            </text>
          </g>
        )}

        {/* client → facade/monolith */}
        {f.facade ? (
          <line x1={70} y1={160} x2={FX - 2} y2={160} stroke="var(--ink-4)" strokeWidth={2} markerEnd="url(#sfm-arr)" />
        ) : (
          <path d={`M70,160 C${FX + 60},160 ${MX - 80},90 ${MX - 2},90`} fill="none" stroke="var(--ink-4)" strokeWidth={2} markerEnd="url(#sfm-arr)" />
        )}

        {/* monolith */}
        <rect x={MX} y={14} width={MW} height={124} rx={10} fill="var(--surface)" stroke="var(--border-strong)" />
        <text x={MX + 10} y={32} fontSize={11} fontWeight={700}>
          monolith
        </text>
        {MODULES.map((m, i) => {
          const st = STATE_STYLE[f.modules[m]];
          const del = f.modules[m] === 'deleted';
          return (
            <g key={m} opacity={del ? 0.5 : 1}>
              <rect x={modX(i)} y={modY(i)} width={92} height={24} rx={6} fill={st.fill} stroke={st.stroke} strokeDasharray={del ? '4 3' : undefined} style={{ transition: 'fill .35s, stroke .35s' }} />
              <text x={modX(i) + 46} y={modY(i) + (st.label ? 11 : 16)} textAnchor="middle" fontSize={10.5} fontWeight={600} textDecoration={del ? 'line-through' : undefined}>
                {m}
              </text>
              {st.label && (
                <text x={modX(i) + 46} y={modY(i) + 21} textAnchor="middle" fontSize={8.5} style={{ fill: st.stroke }}>
                  {st.label}
                </text>
              )}
            </g>
          );
        })}
        {/* facade → monolith */}
        {f.facade && <line x1={FX + FW + 2} y1={90} x2={MX - 2} y2={90} stroke="var(--ink-4)" strokeWidth={1 + (monoW / 100) * 3} markerEnd="url(#sfm-arr)" />}

        {/* new service */}
        <g opacity={f.svcBuilt ? 1 : 0.25}>
          <rect x={MX} y={SVC_Y - 20} width={MW} height={58} rx={10} fill={f.svcBuilt ? 'var(--accent-soft)' : 'none'} stroke="var(--accent)" strokeDasharray={f.svcBuilt ? undefined : '5 4'} />
          <text x={MX + 10} y={SVC_Y - 2} fontSize={11} fontWeight={700} style={{ fill: 'var(--accent)' }}>
            {slice}-svc {f.svcBuilt ? '' : '(not built)'}
          </text>
          <text x={MX + 10} y={SVC_Y + 14} fontSize={9.5} className="viz-label">
            {f.svcBuilt ? `ACL · ${servicePath(slice).ms} ms · ${(servicePath(slice).availability * 100).toFixed(2)}% avail` : 'anti-corruption layer + own DB'}
          </text>
          {f.svcBuilt && info.callsBack > 0 && f.split > 0 && (
            <g>
              <path d={`M${MX + MW - 20},${SVC_Y - 20} L${MX + MW - 20},${140}`} stroke="var(--warn)" strokeWidth={2} strokeDasharray="4 3" markerEnd="url(#sfm-arr)" />
              <text x={MX + MW - 26} y={SVC_Y - 6} textAnchor="end" fontSize={9.5} fontWeight={700} style={{ fill: 'var(--warn)', ...halo }}>
                {info.callsBack} sync calls back
              </text>
            </g>
          )}
        </g>
        {/* facade → service (live or mirrored) */}
        {f.svcBuilt && (f.split > 0 || f.shadow) && (
          <g>
            <line
              x1={FX + FW + 2}
              y1={SVC_Y + 6}
              x2={MX - 2}
              y2={SVC_Y + 6}
              stroke="var(--accent)"
              strokeWidth={f.split > 0 ? 1 + (svcW / 100) * 3 : 1.5}
              strokeDasharray={f.split > 0 ? undefined : '5 4'}
              markerEnd="url(#sfm-arr-acc)"
            />
            {f.shadow && f.split === 0 && (
              <text x={(FX + FW + MX) / 2} y={SVC_Y - 1} textAnchor="middle" fontSize={9.5} fontWeight={700} style={{ fill: f.blocked ? 'var(--bad)' : 'var(--accent)', ...halo }}>
                mirror · diff {f.diffRate}%
              </text>
            )}
          </g>
        )}

        {/* databases */}
        {[
          { x: MX, label: 'monolith DB', owner: f.owner === 'mono' },
          { x: MX + 120, label: `${slice} DB`, owner: f.owner === 'svc', svc: true },
        ].map((d) => (
          <g key={d.label} opacity={d.svc && !f.svcBuilt ? 0.25 : 1}>
            <ellipse cx={d.x + 47} cy={DB_Y} rx={47} ry={7} fill="var(--surface)" stroke={d.svc ? 'var(--accent)' : 'var(--border-strong)'} />
            <path d={`M${d.x},${DB_Y} v30 a47,7 0 0 0 94,0 v-30`} fill="var(--surface)" stroke={d.svc ? 'var(--accent)' : 'var(--border-strong)'} />
            <text x={d.x + 47} y={DB_Y + 19} textAnchor="middle" fontSize={10} fontWeight={600}>
              {d.label}
            </text>
            <text x={d.x + 47} y={DB_Y + 32} textAnchor="middle" fontSize={8.5} style={{ fill: d.owner ? 'var(--good)' : 'var(--text-2)' }} fontWeight={d.owner ? 700 : 400}>
              {d.owner ? `owns ${slice} writes` : d.svc ? 'read copy' : `${slice}: read copy`}
            </text>
          </g>
        ))}
        {f.cdc !== 'none' && (
          <g>
            <line
              x1={f.cdc === 'mono-to-svc' ? MX + 96 : MX + 118}
              x2={f.cdc === 'mono-to-svc' ? MX + 118 : MX + 96}
              y1={DB_Y + 12}
              y2={DB_Y + 12}
              stroke="var(--accent)"
              strokeWidth={2}
              markerEnd="url(#sfm-arr-acc)"
            />
            <text x={MX + 107} y={DB_Y - 12} textAnchor="middle" fontSize={9} fontWeight={700} style={{ fill: 'var(--accent)', ...halo }}>
              CDC
            </text>
          </g>
        )}

        {/* status line */}
        <text x={6} y={262} fontSize={10} fontWeight={700} style={{ fill: f.blocked ? 'var(--bad)' : 'var(--text)' }}>
          {f.phase === 'shadow' || f.phase === 'fix' ? (f.blocked ? `✕ diff ${f.diffRate}% > ${DIFF_LIMIT}%` : `✓ diff ${f.diffRate}% ≤ ${DIFF_LIMIT}%`) : `phase: ${f.phase}`}
        </text>
        <text x={6} y={278} fontSize={9.5} className="viz-label">
          {ROUTES[slice]} latency {f.ms} ms
        </text>
        <text x={6} y={292} fontSize={9.5} className="viz-label">
          availability {(f.availability * 100).toFixed(2)}%
        </text>
        <text x={6} y={306} fontSize={9.5} className="viz-label">
          writer: {f.owner === 'svc' ? `${slice}-svc` : 'monolith'}
        </text>
      </svg>
    </VizFrame>
  );
}
