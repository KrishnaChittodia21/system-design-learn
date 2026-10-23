import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { IN_PLACE_TRIES, MESSAGES, N_MSG, RETRY1_DELAY, RETRY2_DELAY, simulate, type Attempt, type Frame, type Params, type Strategy, type Where } from './sim';

const LANE_X = 92;
const LANE_END = 446;
const SIDE_X = 458;
const SIDE_W = 136;
const CELL = 30;
const PITCH = 34;
const WIDE = 52;
const Y = { main: 28, retry1: 90, retry2: 146, dlq: 202, done: 258 } as const;
const CELL_H = 36;
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

type Spot = { x: number; y: number; w: number; due?: number };

function place(f: Frame): Map<number, Spot> {
  const at = new Map<number, Spot>();
  f.main.forEach((id, i) => at.set(id, { x: LANE_END - 4 - (i + 1) * PITCH + (PITCH - CELL), y: Y.main, w: CELL }));
  f.retry1.forEach((w, i) => at.set(w.id, { x: LANE_X + 6 + i * (WIDE + 6), y: Y.retry1, w: WIDE, due: w.notBefore }));
  f.retry2.forEach((w, i) => at.set(w.id, { x: LANE_X + 6 + i * (WIDE + 6), y: Y.retry2, w: WIDE, due: w.notBefore }));
  f.dlq.forEach((id, i) => at.set(id, { x: LANE_X + 6 + i * PITCH, y: Y.dlq, w: CELL }));
  f.done.forEach((id, i) => at.set(id, { x: LANE_X + 6 + i * PITCH, y: Y.done, w: CELL }));
  return at;
}

const KIND_STYLE = {
  ok: { fill: 'var(--surface)', stroke: 'var(--border-strong)' },
  poison: { fill: 'var(--bad-soft)', stroke: 'var(--bad)' },
  flaky: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
} as const;

function SideBox({ y, title, line, tone }: { y: number; title: string; line: string; tone: 'idle' | 'ok' | 'bad' | 'warn' }) {
  const stroke = tone === 'ok' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--border)';
  const fill = tone === 'ok' ? 'var(--good-soft)' : tone === 'bad' ? 'var(--bad-soft)' : tone === 'warn' ? 'var(--warn-soft)' : 'var(--surface)';
  return (
    <g>
      <rect x={SIDE_X} y={y} width={SIDE_W} height={CELL_H + 4} rx={8} fill={fill} stroke={stroke} strokeWidth={1.5} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
      <text x={SIDE_X + 8} y={y + 16} fontSize={10.5} fontWeight={700}>
        {title}
      </text>
      <text x={SIDE_X + 8} y={y + 31} fontSize={10} style={{ fill: 'var(--text-2)' }}>
        {line}
      </text>
    </g>
  );
}

function consumerLine(a: Attempt | undefined, paused: number | undefined) {
  if (a) {
    const ok = a.outcome === 'ok';
    return { line: `m${a.id} · try ${a.n} ${ok ? '✓' : '✗'}`, tone: (ok ? 'ok' : 'bad') as 'ok' | 'bad' };
  }
  if (paused !== undefined) return { line: `paused until t=${paused}`, tone: 'idle' as const };
  return { line: 'idle', tone: 'idle' as const };
}

function Drawing({ f }: { f: Frame }) {
  const at = place(f);
  const by = (w: Where) => f.attempts.find((a) => a.where === w);
  const just = new Map(f.attempts.map((a) => [a.id, a]));
  const lanes: { key: keyof typeof Y; label: string; sub: string; end: number }[] = [
    { key: 'main', label: 'main', sub: 'partition', end: LANE_END },
    { key: 'retry1', label: 'retry-1', sub: `wait ${RETRY1_DELAY} ticks`, end: LANE_END },
    { key: 'retry2', label: 'retry-2', sub: `wait ${RETRY2_DELAY} ticks`, end: LANE_END },
    { key: 'dlq', label: 'DLQ', sub: 'parked', end: 596 },
    { key: 'done', label: 'processed', sub: 'in order done', end: 596 },
  ];
  const mainC = consumerLine(by('main'), undefined);
  const r1 = consumerLine(by('retry1'), f.retry1[0]?.notBefore);
  const r2 = consumerLine(by('retry2'), f.retry2[0]?.notBefore);
  const aria =
    f.tick < 0
      ? `Empty partition. ${N_MSG} messages will be produced; m4 is a poison pill, m8 is flaky.`
      : `Tick ${f.tick}. Main partition: ${f.main.map((i) => `m${i}`).join(', ') || 'empty'}. Retry-1: ${f.retry1.map((w) => `m${w.id}`).join(', ') || 'empty'}. Retry-2: ${
          f.retry2.map((w) => `m${w.id}`).join(', ') || 'empty'
        }. DLQ: ${f.dlq.map((i) => `m${i}`).join(', ') || 'empty'}. Processed ${f.done.length}. Lag ${f.lag}.`;
  return (
    <svg viewBox="0 0 600 334" className="viz-svg" role="img" aria-label={aria}>
      {lanes.map((l) => (
        <g key={l.key}>
          <rect x={LANE_X} y={Y[l.key] - 4} width={l.end - LANE_X} height={CELL_H + 8} rx={8} fill="var(--surface-2)" stroke="var(--border)" strokeDasharray={l.key === 'done' ? undefined : '4 3'} />
          <text x={6} y={Y[l.key] + 15} fontSize={11.5} fontWeight={700}>
            {l.label}
          </text>
          <text x={6} y={Y[l.key] + 29} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
            {l.sub}
          </text>
        </g>
      ))}
      {/* consumers */}
      <SideBox y={Y.main - 2} title="main consumer" line={mainC.line} tone={mainC.tone} />
      <SideBox y={Y.retry1 - 2} title="retry-1 consumer" line={r1.line} tone={r1.tone} />
      <SideBox y={Y.retry2 - 2} title="retry-2 consumer" line={r2.line} tone={r2.tone} />
      {f.tick >= 0 && f.lag > 0 && (
        <text x={LANE_X + 6} y={Y.main + 52} fontSize={10} fontWeight={700} style={{ fill: f.lag > 2 ? 'var(--bad)' : 'var(--text-2)', ...halo }}>
          ← newest · lag {f.lag} · oldest waiting {f.oldestAge} tick{f.oldestAge === 1 ? '' : 's'} · head →
        </text>
      )}
      {f.dlq.length > 0 && (
        <text x={590} y={Y.dlq + 22} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--bad)' }}>
          ⚠ alert: DLQ depth {f.dlq.length}
        </text>
      )}

      {/* messages: one element per message so it glides between lanes */}
      {MESSAGES.map((m) => {
        const s = at.get(m.id);
        if (!s) return null;
        const st = KIND_STYLE[m.kind];
        const a = just.get(m.id);
        const ooo = f.outOfOrder.includes(m.id);
        return (
          <g key={m.id} style={{ transform: `translate(${s.x}px, ${s.y}px)`, transition: 'transform 0.45s ease' }}>
            <rect
              width={s.w}
              height={CELL_H}
              rx={6}
              fill={st.fill}
              stroke={a ? 'var(--accent)' : ooo ? 'var(--bad)' : st.stroke}
              strokeWidth={a ? 2.6 : ooo ? 2 : 1.3}
              strokeDasharray={ooo && !a ? '3 2' : undefined}
            />
            <text x={s.w / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700}>
              m{m.id}
            </text>
            <text x={s.w / 2} y={29} textAnchor="middle" fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
              {s.due !== undefined ? `${m.key} · t${s.due}` : `key ${m.key}`}
            </text>
            {a && (
              <text x={s.w - 2} y={-3} textAnchor="end" fontSize={12} fontWeight={800} style={{ fill: a.outcome === 'ok' ? 'var(--good)' : 'var(--bad)', ...halo }}>
                {a.outcome === 'ok' ? '✓' : '✗'}
              </text>
            )}
            {ooo && (
              <text x={2} y={-3} fontSize={9} fontWeight={700} style={{ fill: 'var(--bad)', ...halo }}>
                order!
              </text>
            )}
          </g>
        );
      })}

      {/* footer metrics */}
      <text x={300} y={326} textAnchor="middle" fontSize={11} fontWeight={600}>
        attempts {f.totalAttempts} (failed {f.failedAttempts}) · processed {f.done.length}/{N_MSG} · DLQ {f.dlq.length} · out-of-order {f.outOfOrder.length}
      </text>
    </svg>
  );
}

export default function MqPoisonDlqViz() {
  const [params, setParams] = useState<Params>({ strategy: 'tiered' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Choice<Strategy>
          label="Failure handling"
          value={params.strategy}
          options={[
            { value: 'inplace', label: 'Retry in place forever' },
            { value: 'tiered', label: `${IN_PLACE_TRIES} tries → retry topics → DLQ` },
            { value: 'classified', label: '+ permanent errors skip to DLQ' },
          ]}
          onChange={(strategy) => setParams({ strategy })}
        />
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> poison pill (never succeeds)
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> flaky (transient 503)
          <span className="viz-key ring" style={{ borderColor: 'var(--accent)' }} /> attempted this tick
          <span className="viz-key" style={{ background: 'transparent', border: '2px dashed var(--bad)' }} /> processed before an earlier same-key message
        </>
      }
    >
      <Drawing f={stepper.frame} />
    </VizFrame>
  );
}

