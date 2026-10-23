import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CALENDAR_CONTRACT, CHANGES, CLIENTS, SUNSET, WEEKS, simulate, type Change, type ClientState, type Frame, type Params, type Strategy } from './sim';

const CARD_W = 190;
const CARD_Y = 96;
const CARD_H = 118;
const TL_Y = 262;
const TL_X0 = 40;
const TL_X1 = 580;
const wx = (w: number) => TL_X0 + (w / WEEKS) * (TL_X1 - TL_X0);

const STATE: Record<ClientState, { label: string; fill: string; stroke: string }> = {
  ok: { label: 'working', fill: 'var(--surface)', stroke: 'var(--border-strong)' },
  migrating: { label: 'migrating', fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  migrated: { label: 'migrated', fill: 'var(--good-soft)', stroke: 'var(--good)' },
  broken: { label: 'BROKEN', fill: 'var(--bad-soft)', stroke: 'var(--bad)' },
  blocked: { label: 'pact fails', fill: 'var(--bad-soft)', stroke: 'var(--bad)' },
  'upgrade-prompt': { label: 'forced upgrade', fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
};

/** greedy word wrap for SVG text */
function wrap(s: string, max: number, lines = 2) {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = out[lines - 1].replace(/.{0,1}$/, '…');
  }
  return out;
}

function Drawing({ f, params }: { f: Frame; params: Params }) {
  const aria =
    `Week ${f.week}, ${f.stage}. Server: ${f.server}. ` +
    f.clients.map((c) => `${CLIENTS.find((x) => x.id === c.id)!.name}: ${STATE[c.state].label}, ${c.detail}`).join('; ') +
    (f.gateMsg ? `. Gate: ${f.gateMsg}` : '');
  const gateTone = f.gateOk === null ? 'var(--text-2)' : f.gateOk ? 'var(--good)' : 'var(--bad)';
  return (
    <svg viewBox="0 0 600 300" className="viz-svg" role="img" aria-label={aria}>
      {/* server */}
      <rect x={4} y={4} width={592} height={50} rx={10} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.5} />
      <text x={16} y={23} fontSize={11} fontWeight={700}>
        API server · {CHANGES[params.change].label}
      </text>
      <text x={16} y={42} fontSize={11} fontFamily="var(--f-mono)" style={{ fill: 'var(--text)' }}>
        {f.server}
      </text>
      {/* gate */}
      <text x={8} y={78} fontSize={10.5} fontWeight={700} style={{ fill: gateTone }}>
        {params.gate ? `◆ ${f.gateMsg ?? 'evidence gate: Pact can-i-deploy + field-usage telemetry'}` : '◇ no evidence gate: the team relies on review and the calendar'}
      </text>
      {/* clients */}
      {f.clients.map((c, i) => {
        const info = CLIENTS.find((x) => x.id === c.id)!;
        const st = STATE[c.state];
        const x = 4 + i * (CARD_W + 11);
        const lines = wrap(c.detail, 34);
        return (
          <g key={c.id}>
            <rect x={x} y={CARD_Y} width={CARD_W} height={CARD_H} rx={10} fill={st.fill} stroke={st.stroke} strokeWidth={c.state === 'broken' ? 2.4 : 1.4} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
            <text x={x + 10} y={CARD_Y + 18} fontSize={12} fontWeight={700}>
              {info.name}
            </text>
            <text x={x + CARD_W - 10} y={CARD_Y + 18} textAnchor="end" fontSize={10} fontWeight={800} style={{ fill: st.stroke === 'var(--border-strong)' ? 'var(--text-2)' : st.stroke }}>
              {st.label}
            </text>
            {wrap(info.note, 30).map((l, k) => (
              <text key={k} x={x + 10} y={CARD_Y + 33 + k * 12} fontSize={9} style={{ fill: 'var(--text-2)' }}>
                {l}
              </text>
            ))}
            {c.oldShare !== null && (
              <g>
                <rect x={x + 10} y={CARD_Y + 58} width={CARD_W - 20} height={8} rx={4} fill="var(--surface-2)" stroke="var(--border)" />
                <rect
                  x={x + 10}
                  y={CARD_Y + 58}
                  width={(CARD_W - 20) * c.oldShare}
                  height={8}
                  rx={4}
                  fill={c.state === 'broken' ? 'var(--bad)' : 'var(--warn)'}
                  style={{ transition: 'width 0.45s ease' }}
                />
                <text x={x + 10} y={CARD_Y + 80} fontSize={9.5} fontWeight={600}>
                  {Math.round(c.oldShare * 100)}% of its traffic on the old contract
                </text>
              </g>
            )}
            {lines.map((l, k) => (
              <text key={k} x={x + 10} y={CARD_Y + 96 + k * 12} fontSize={9.5} style={{ fill: c.state === 'broken' || c.state === 'blocked' ? 'var(--bad)' : 'var(--text)' }}>
                {l}
              </text>
            ))}
            <text x={x + CARD_W - 10} y={CARD_Y + 33} textAnchor="end" fontSize={9} fontWeight={700} style={{ fill: c.pact === 'fail' ? 'var(--bad)' : c.pact === 'blind' ? 'var(--warn)' : c.pact === 'pass' ? 'var(--good)' : 'var(--text-2)' }}>
              {info.pact ? (c.pact === 'fail' ? 'pact ✗' : c.pact === 'pass' ? 'pact ✓' : c.pact === 'blind' ? 'pact ✓ (blind)' : 'pact') : ''}
            </text>
          </g>
        );
      })}
      {/* timeline */}
      <text x={6} y={TL_Y + 4} style={{ fill: 'var(--text-2)' }} fontSize={10}>
        week
      </text>
      <line x1={TL_X0} y1={TL_Y} x2={TL_X1} y2={TL_Y} stroke="var(--border-strong)" strokeWidth={1.5} />
      {Array.from({ length: WEEKS + 1 }, (_, w) => (
        <g key={w}>
          <line x1={wx(w)} y1={TL_Y - 4} x2={wx(w)} y2={TL_Y + 4} stroke="var(--border-strong)" />
          <text x={wx(w)} y={TL_Y + 16} textAnchor="middle" fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
            {w}
          </text>
        </g>
      ))}
      {params.strategy === 'expand' && (
        <g>
          <text x={wx(params.gate ? SUNSET : CALENDAR_CONTRACT)} y={TL_Y + 30} textAnchor="middle" fontSize={9} style={{ fill: 'var(--text-2)' }}>
            {params.gate ? 'sunset date' : 'notice period ends'}
          </text>
        </g>
      )}
      {f.timeline.map((t, k) => (
        <g key={k}>
          <circle cx={wx(t.week)} cy={TL_Y} r={6} fill={t.tone === 'bad' ? 'var(--bad)' : t.tone === 'warn' ? 'var(--warn)' : 'var(--good)'} />
          <text x={wx(t.week)} y={TL_Y - 11} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: t.tone === 'bad' ? 'var(--bad)' : 'var(--text)' }}>
            {t.label}
          </text>
        </g>
      ))}
      <g style={{ transform: `translate(${wx(f.week)}px, ${TL_Y}px)`, transition: 'transform 0.45s ease' }}>
        <circle r={10} fill="none" stroke="var(--accent)" strokeWidth={2} />
      </g>
    </svg>
  );
}

export default function ExpandContractCompatViz() {
  const [params, setParams] = useState<Params>({ change: 'rename', strategy: 'direct', gate: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Change>
            label="Change"
            value={params.change}
            options={[
              { value: 'rename', label: 'Rename field' },
              { value: 'add-field', label: 'Add response field' },
              { value: 'enum', label: 'Add enum value' },
              { value: 'required', label: 'Required request field' },
            ]}
            onChange={(change) => setParams((p) => ({ ...p, change }))}
          />
          <Choice<Strategy>
            label="Ship it"
            value={params.strategy}
            options={[
              { value: 'direct', label: 'In one release' },
              { value: 'expand', label: 'Expand → contract' },
            ]}
            onChange={(strategy) => setParams((p) => ({ ...p, strategy }))}
          />
          <Choice<'on' | 'off'>
            label="Evidence gate (Pact + telemetry)"
            value={params.gate ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, gate: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> compatible / migrated
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> still on the old contract
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> broken in production or blocked in CI
        </>
      }
    >
      <Drawing f={stepper.frame} params={params} />
    </VizFrame>
  );
}
