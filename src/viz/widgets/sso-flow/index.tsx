import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, LANES, laneName, simulate, type IdpState, type Kind, type Lane, type Logout, type Params, type Protocol, type SsoFrame } from './sim';

const LANE_X: Record<Lane, number> = { appA: 75, browser: 225, idp: 375, appB: 525 };
const KIND: Record<Kind, { color: string; dash?: string }> = {
  request: { color: 'var(--accent)' },
  redirect: { color: 'var(--warn)' },
  response: { color: 'var(--good)' },
  back: { color: 'var(--text-2)', dash: '6 3' },
  secret: { color: 'var(--bad)' },
};
const WINDOW = 9;
const ROW = 24;
const TOP = 58;
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round' as const };

function Chip({ x, y, label, state }: { x: number; y: number; label: string; state: 'on' | 'off' | 'dead' }) {
  const fill = state === 'on' ? 'var(--good-soft)' : state === 'dead' ? 'var(--bad-soft)' : 'var(--surface-2)';
  const stroke = state === 'on' ? 'var(--good)' : state === 'dead' ? 'var(--bad)' : 'var(--border)';
  const w = label.length * 6 + 16;
  return (
    <g opacity={state === 'off' ? 0.6 : 1}>
      <rect x={x} y={y} width={w} height={18} rx={9} fill={fill} stroke={stroke} />
      <text x={x + w / 2} y={y + 13} textAnchor="middle" fontSize={9.5} fontWeight={700} style={{ textDecoration: state === 'dead' ? 'line-through' : undefined }}>
        {label}
      </text>
    </g>
  );
}

function Drawing({ f, protocol }: { f: SsoFrame; protocol: Protocol }) {
  const shown = f.msgs.slice(-WINDOW);
  const hidden = f.msgs.length - shown.length;
  const { jar, srv } = f.s;
  const cookie = (k: 'idp' | 'A' | 'B') => (jar[k] ? (srv[k] ? 'on' : 'dead') : 'off') as 'on' | 'off' | 'dead';
  const sess = (k: 'idp' | 'A' | 'B') => (srv[k] ? 'on' : 'off') as 'on' | 'off';
  const label = `${f.phase}. ${f.msgs.length} messages so far. Browser cookies: ${(['idp', 'A', 'B'] as const)
    .filter((k) => jar[k])
    .map((k) => `${k}_sid${srv[k] ? '' : ' (dead)'}`)
    .join(', ') || 'none'}. Password prompts: ${f.prompts}.`;
  return (
    <svg viewBox="0 0 600 340" className="viz-svg" role="img" aria-label={label}>
      <defs>
        {(Object.keys(KIND) as Kind[]).map((k) => (
          <marker key={k} id={`sso-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={KIND[k].color} />
          </marker>
        ))}
      </defs>
      {LANES.map((l) => (
        <g key={l}>
          <rect x={LANE_X[l] - 66} y={4} width={132} height={26} rx={7} fill={l === 'browser' ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke="var(--border)" />
          <text x={LANE_X[l]} y={21} textAnchor="middle" fontSize={10.5} fontWeight={700}>
            {laneName(l, protocol)}
          </text>
          <line x1={LANE_X[l]} x2={LANE_X[l]} y1={30} y2={TOP + WINDOW * ROW - 8} stroke="var(--border)" strokeWidth={1.5} />
        </g>
      ))}
      {hidden > 0 && (
        <text x={300} y={44} textAnchor="middle" fontSize={9} className="viz-label">
          ⋮ messages 1–{hidden} scrolled up
        </text>
      )}
      {shown.map((m, i) => {
        const y = TOP + i * ROW + 10;
        const x1 = LANE_X[m.from];
        const x2 = LANE_X[m.to];
        const cur = f.cur >= 0 && f.msgs[f.cur] === m;
        const k = KIND[m.kind];
        const w = m.label.length * 5.2 + 22;
        const mid = Math.min(596 - w / 2, Math.max(4 + w / 2, (x1 + x2) / 2));
        const dir = x2 > x1 ? 1 : -1;
        return (
          <g key={m.n} opacity={cur ? 1 : 0.55}>
            <line
              x1={x1 + dir * 3}
              y1={y}
              x2={x2 - dir * 3}
              y2={y}
              stroke={k.color}
              strokeWidth={cur ? 2.4 : 1.5}
              strokeDasharray={k.dash}
              markerEnd={`url(#sso-arrow-${m.kind})`}
            />
            <text x={mid} y={y - 4} textAnchor="middle" fontSize={9.5} fontWeight={cur ? 700 : 400} style={halo}>
              <tspan fontWeight={700} style={{ fill: k.color }}>
                {m.n}.
              </tspan>{' '}
              {m.label}
            </text>
          </g>
        );
      })}
      {/* state panel */}
      <rect x={2} y={276} width={596} height={62} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
      <text x={10} y={292} fontSize={10} fontWeight={700}>
        Browser cookies
      </text>
      <Chip x={110} y={280} label="idp_sid" state={cookie('idp')} />
      <Chip x={180} y={280} label="A_sid" state={cookie('A')} />
      <Chip x={240} y={280} label="B_sid" state={cookie('B')} />
      <text x={10} y={318} fontSize={10} fontWeight={700}>
        Server sessions
      </text>
      <Chip x={110} y={306} label="IdP" state={sess('idp')} />
      <Chip x={160} y={306} label={protocol === 'oidc' ? 'App A' : 'SP A'} state={sess('A')} />
      <Chip x={222} y={306} label={protocol === 'oidc' ? 'App B' : 'SP B'} state={sess('B')} />
      <text x={588} y={296} textAnchor="end" fontSize={10.5} fontWeight={700}>
        {f.phase}
      </text>
      <text x={588} y={320} textAnchor="end" fontSize={11} fontWeight={700} style={{ fill: f.prompts > 1 ? 'var(--bad)' : undefined }}>
        🔑 password prompts: {f.prompts}
      </text>
    </svg>
  );
}

export default function SsoFlowViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Protocol>
            label="Protocol"
            value={params.protocol}
            options={[
              { value: 'oidc', label: 'OIDC code + PKCE' },
              { value: 'saml', label: 'SAML 2.0 (SP-initiated)' },
            ]}
            onChange={set('protocol')}
          />
          <Choice<IdpState>
            label="IdP session when opening app B"
            value={params.idpSession}
            options={[
              { value: 'active', label: 'Still valid' },
              { value: 'expired', label: 'Expired' },
            ]}
            onChange={set('idpSession')}
          />
          <Choice<Logout>
            label="Then"
            value={params.logout}
            options={[
              { value: 'none', label: 'No logout' },
              { value: 'local', label: 'Log out of A only' },
              { value: 'slo', label: 'Single logout' },
            ]}
            onChange={set('logout')}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> browser request
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> redirect / auto-POST
          <span className="viz-key" style={{ background: 'var(--good)' }} /> response
          <span className="viz-key" style={{ background: 'var(--text-2)' }} /> back channel (server to server)
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> password
        </>
      }
    >
      <Drawing f={stepper.frame} protocol={params.protocol} />
    </VizFrame>
  );
}
