import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { SCENARIOS, simulate, type Frame, type Params, type Scenario, type Status, type Validator } from './sim';

const LX = 4;
const LW = 236;
const RX = 252;
const ROW_H = 27;
const RY = 26;

const ST: Record<Status, { icon: string; color: string; fill: string }> = {
  pending: { icon: '·', color: 'var(--text-2)', fill: 'var(--surface)' },
  pass: { icon: '✓', color: 'var(--good)', fill: 'var(--good-soft)' },
  fail: { icon: '✗', color: 'var(--bad)', fill: 'var(--bad-soft)' },
  skip: { icon: '–', color: 'var(--text-2)', fill: 'var(--surface-2)' },
  fooled: { icon: '!', color: 'var(--warn)', fill: 'var(--warn-soft)' },
};

function Drawing({ f }: { f: Frame }) {
  const mono = { fontFamily: 'var(--f-mono)' };
  let y = 44;
  const lines: { text: string; hot?: boolean; head?: boolean; y: number }[] = [];
  const add = (text: string, o: { hot?: boolean; head?: boolean } = {}, dy = 15) => {
    lines.push({ text, ...o, y });
    y += dy;
  };
  add('HEADER', { head: true });
  f.token.header.forEach((l) => add(l.text, { hot: l.hot }));
  y += 4;
  add('PAYLOAD (claims)', { head: true });
  f.token.payload.forEach((l) => add(l.text, { hot: l.hot }));
  y += 4;
  add('SIGNATURE', { head: true });
  add(f.token.sig);
  const verdictTone = f.verdict === 'correct-allow' || f.verdict === 'correct-deny' ? 'good' : f.verdict ? 'bad' : null;
  const aria =
    `Request ${f.token.request}. ` +
    f.checks
      .filter((c) => c.status !== 'pending')
      .map((c) => `${c.label}: ${c.status}, ${c.note}`)
      .join('; ') +
    (f.response ? `. Response ${f.response.code} ${f.response.text}.` : '');
  return (
    <svg viewBox="0 0 600 336" className="viz-svg" role="img" aria-label={aria}>
      {/* request + decoded token */}
      <rect x={LX} y={2} width={LW} height={286} rx={10} fill="var(--surface)" stroke="var(--border)" />
      <text x={LX + 10} y={20} fontSize={10.5} fontWeight={700}>
        {f.token.request}
      </text>
      <text x={LX + 10} y={34} fontSize={9} style={{ fill: 'var(--text-2)' }}>
        Bearer token, decoded (anyone can read it)
      </text>
      {lines.map((l, k) =>
        l.head ? (
          <text key={k} x={LX + 10} y={l.y + 10} fontSize={9} fontWeight={700} style={{ fill: 'var(--text-2)', letterSpacing: '0.08em' }}>
            {l.text}
          </text>
        ) : (
          <g key={k}>
            {l.hot && <rect x={LX + 6} y={l.y - 1} width={LW - 12} height={15} rx={4} fill="var(--bad-soft)" />}
            <text x={LX + 12} y={l.y + 10} fontSize={9.5} style={{ ...mono, fill: l.hot ? 'var(--bad)' : 'var(--text)' }} fontWeight={l.hot ? 700 : 400}>
              {l.text}
            </text>
          </g>
        ),
      )}

      {/* pipeline */}
      <text x={RX} y={16} fontSize={10.5} fontWeight={700}>
        API gateway checks, in order
      </text>
      {f.checks.map((c, i) => {
        const st = ST[c.status];
        const cy = RY + i * ROW_H;
        const now = i === f.cur;
        const authz = c.id === 'scope' || c.id === 'owner';
        return (
          <g key={c.id}>
            {authz && i === 7 && <line x1={RX} x2={596} y1={cy - 2} y2={cy - 2} stroke="var(--border-strong)" strokeDasharray="4 3" />}
            <rect x={RX} y={cy + 1} width={344} height={ROW_H - 4} rx={6} fill={st.fill} stroke={now ? 'var(--accent)' : 'var(--border)'} strokeWidth={now ? 2 : 1} style={{ transition: 'fill 0.3s ease' }} />
            <circle cx={RX + 13} cy={cy + 12.5} r={8} fill="var(--surface)" stroke={st.color} strokeWidth={1.5} />
            <text x={RX + 13} y={cy + 16.5} textAnchor="middle" fontSize={11} fontWeight={800} style={{ fill: st.color }}>
              {st.icon}
            </text>
            <text x={RX + 28} y={cy + 11} fontSize={10} fontWeight={700}>
              {i + 1}. {c.label}
            </text>
            <text x={RX + 28} y={cy + 21} fontSize={8.8} style={{ fill: c.status === 'fail' ? 'var(--bad)' : c.status === 'fooled' ? 'var(--warn)' : 'var(--text-2)' }}>
              {c.note.length > 62 ? c.note.slice(0, 61) + '…' : c.note}
            </text>
          </g>
        );
      })}

      {/* response */}
      {f.response ? (
        <g>
          <rect x={LX} y={296} width={592} height={36} rx={10} fill={verdictTone === 'good' ? 'var(--good-soft)' : 'var(--bad-soft)'} stroke={verdictTone === 'good' ? 'var(--good)' : 'var(--bad)'} strokeWidth={2} />
          <text x={LX + 12} y={318} fontSize={12} fontWeight={800} style={{ fill: verdictTone === 'good' ? 'var(--good)' : 'var(--bad)' }}>
            HTTP {f.response.code}
          </text>
          <text x={LX + 78} y={318} fontSize={11}>
            {f.response.text}
          </text>
          <text x={590} y={318} textAnchor="end" fontSize={11} fontWeight={800} style={{ fill: verdictTone === 'good' ? 'var(--good)' : 'var(--bad)' }}>
            {f.verdict === 'attack-succeeded' ? 'ATTACK GOT THROUGH' : f.verdict === 'legit-denied' ? 'REAL USER LOCKED OUT' : 'correct outcome'}
          </text>
        </g>
      ) : (
        <text x={300} y={318} textAnchor="middle" fontSize={10.5} style={{ fill: 'var(--text-2)' }}>
          response pending…
        </text>
      )}
    </svg>
  );
}

export default function JwtValidationGauntletViz() {
  const [params, setParams] = useState<Params>({ scenario: 'alg-none', validator: 'naive', ownership: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Token"
            value={params.scenario}
            options={(Object.keys(SCENARIOS) as Scenario[]).map((value) => ({ value, label: SCENARIOS[value].label }))}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Choice<Validator>
            label="Validator"
            value={params.validator}
            options={[
              { value: 'naive', label: 'Naive (alg from header)' },
              { value: 'strict', label: 'Strict (pinned, JWKS, iss/aud)' },
            ]}
            onChange={(validator) => setParams((p) => ({ ...p, validator }))}
          />
          <Choice<'off' | 'on'>
            label="Object-level check"
            value={params.ownership ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, ownership: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> passed
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> rejected / notable token field
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> fooled by the token
          <span className="viz-key" style={{ background: 'var(--text-2)' }} /> skipped
        </>
      }
    >
      <Drawing f={stepper.frame} />
    </VizFrame>
  );
}
