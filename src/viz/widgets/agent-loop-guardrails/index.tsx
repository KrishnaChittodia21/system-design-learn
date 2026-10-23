// The agent loop: the model proposes, the runtime validates and executes, budgets stop it.
import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { meta } from './meta';
import { REGISTRY, TIME_BUDGET_S, TOKEN_BUDGET, simulateAgent, type AgentParams, type Line, type Scenario } from './sim';
import { stroke } from './tones';

const NODES: NodeDef[] = [
  { id: 'user', label: 'User', sub: 'in-app chat', x: 4, y: 58, w: 96, h: 44 },
  { id: 'runtime', label: 'Agent runtime', sub: 'loop · budgets · run log', x: 150, y: 52, w: 160, h: 56 },
  { id: 'model', label: 'Model', sub: 'stateless LLM', x: 362, y: 8, w: 124, h: 44 },
  { id: 'tools', label: 'Tool gateway', sub: 'user-scoped token', x: 362, y: 108, w: 124, h: 44 },
  { id: 'guard', label: 'Guardrails', sub: 'schema · owner · taint', x: 150, y: 134, w: 160, h: 40 },
  { id: 'human', label: 'Human queue', sub: 'handoff', x: 4, y: 134, w: 96, h: 40 },
];
const LINKS: [string, string][] = [
  ['user', 'runtime'],
  ['runtime', 'model'],
  ['runtime', 'tools'],
  ['runtime', 'guard'],
  ['runtime', 'human'],
];
const ROLE_TONE: Record<Line['role'], 'accent' | 'mag' | 'good' | 'warn' | 'muted'> = { user: 'accent', model: 'mag', tool: 'good', guard: 'warn', runtime: 'muted' };

/** greedy word wrap by character count (SVG text does not wrap) */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export default function AgentLoopGuardrails() {
  const [params, setParams] = useState<AgentParams>({ scenario: 'injection', guardrails: true, stepBudget: 8 });
  const frames = useSimulation(simulateAgent, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));

  // transcript rows, wrapped, newest at the bottom
  const rows = f.transcript.flatMap((l) => wrap(l.text, 56).map((t, k) => ({ role: k === 0 ? l.role : null, text: t, tone: l.tone })));
  const shown = rows.slice(-10);
  const meters = [
    { label: 'model steps', v: f.step, max: params.stepBudget, fmt: `${f.step}/${params.stepBudget}` },
    { label: 'input tokens', v: f.tokens, max: TOKEN_BUDGET, fmt: `${(f.tokens / 1000).toFixed(1)}K/${TOKEN_BUDGET / 1000}K` },
    { label: 'wall clock', v: f.seconds, max: TIME_BUDGET_S, fmt: `${f.seconds}s/${TIME_BUDGET_S}s` },
  ];
  const outcomeTone = f.outcome === 'answered' ? 'good' : f.outcome === 'compromised' ? 'bad' : f.outcome === 'handoff' ? 'warn' : 'accent';
  const aria = `Agent loop step ${stepper.i + 1}: ${f.step} model calls, ${f.tokens} input tokens, ${f.seconds} seconds, ${f.tainted ? 'run tainted, ' : ''}outcome ${f.outcome}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Scenario"
            value={params.scenario}
            options={[
              { value: 'happy', label: 'Clean run' },
              { value: 'injection', label: 'Injected UPI remark' },
              { value: 'loop', label: 'Tool keeps timing out' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Choice<'on' | 'off'>
            label="Guardrails"
            value={params.guardrails ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, guardrails: v === 'on' }))}
          />
          <Slider label="Step budget" value={params.stepBudget} min={3} max={10} onChange={(stepBudget) => setParams((p) => ({ ...p, stepBudget }))} />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> user / request
          <Key tone="mag" /> model output
          <Key tone="good" /> tool result / allowed
          <Key tone="warn" /> guardrail / budget stop
          <Key tone="bad" /> untrusted or harmful
        </>
      }
    >
      <svg viewBox="0 0 600 364" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {LINKS.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {NODES.map((n) => (
          <Box
            key={n.id}
            n={n}
            tone={f.active[n.id]}
            dim={(!params.guardrails && n.id === 'guard') || (Object.keys(f.active).length > 0 && !f.active[n.id])}
            badge={n.id === 'runtime' && f.tainted ? 'TAINTED' : n.id === 'guard' && !params.guardrails ? 'OFF' : undefined}
            badgeTone="bad"
          />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} bend={['model', 'tools'].includes(e.from) || ['model', 'tools'].includes(e.to) ? 9 : 0} packet k={`${stepper.i}-${k}`} />
        ))}

        {/* budgets */}
        {meters.map((m, k) => {
          const y = 14 + k * 50;
          const pct = Math.min(1, m.v / m.max);
          const tone = pct >= 1 ? 'bad' : pct > 0.75 ? 'warn' : 'accent';
          return (
            <g key={m.label}>
              <text x={500} y={y + 10} fontSize={9.5} className="alg-muted">
                {m.label}
              </text>
              <rect x={500} y={y + 16} width={94} height={10} rx={3} fill="var(--tint)" stroke="var(--line)" />
              <rect x={500} y={y + 16} width={94 * pct} height={10} rx={3} fill={stroke(tone)} style={{ transition: 'width 0.35s ease' }} />
              <text x={500} y={y + 40} fontSize={10} fontWeight={800} fontFamily="var(--f-mono)">
                {m.fmt}
              </text>
            </g>
          );
        })}
        <Pill x={596} y={176} text={f.outcome === 'running' ? 'running' : f.outcome === 'answered' ? 'answered' : f.outcome === 'handoff' ? `handoff: ${f.stopReason}` : 'COMPROMISED'} tone={outcomeTone} anchor="end" size={9} />

        <Panel x={8} y={190} w={250} h={170} title="Tool registry (what the model may call)">
          {REGISTRY.map((t, k) => {
            const focus = f.toolInFocus === t.name;
            return (
              <g key={t.name}>
                {focus && <rect x={12} y={204 + k * 24} width={242} height={22} rx={5} fill="var(--blue-s)" stroke="var(--blue)" />}
                <text x={18} y={219 + k * 24} fontSize={9.5} fontFamily="var(--f-mono)" fontWeight={focus ? 800 : 500}>
                  {t.name}
                </text>
                <Pill x={150} y={217 + k * 24} text={t.kind} tone={t.kind === 'read' ? 'good' : 'warn'} size={8.5} />
                <text x={248} y={219 + k * 24} fontSize={8.5} textAnchor="end" className="alg-muted">
                  {t.confirm ? 'confirm' : t.note}
                </text>
              </g>
            );
          })}
          <text x={18} y={354} fontSize={8.5} className="alg-muted">
            no tool moves money · no generic send_email
          </text>
        </Panel>

        <Panel x={266} y={190} w={326} h={170} title="Transcript (re-sent to the model every step)">
          {shown.map((r, k) => (
            <g key={`${rows.length}-${k}`}>
              {r.role && (
                <text x={276} y={216 + k * 14.5} fontSize={8.5} fontWeight={800} style={{ fill: stroke(ROLE_TONE[r.role]) }}>
                  {r.role}
                </text>
              )}
              <text x={322} y={216 + k * 14.5} fontSize={9} style={{ fill: r.tone === 'bad' ? 'var(--bad)' : 'var(--ink)' }}>
                {r.text}
              </text>
            </g>
          ))}
        </Panel>
      </svg>
    </VizFrame>
  );
}
