import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type Guard, type Params, type UserState } from './sim';

const SEAT_X = (i: number) => 26 + i * 72;
const SEAT_W = 60;
const USER_TONE: Record<UserState, string | null> = {
  browsing: null,
  holding: 'warn',
  booked: 'good',
  failed: 'bad',
  refunded: 'bad',
  waiting: 'warn',
  'gave up': null,
};

export default function TicketSeatRaceViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const aria = `t=${f.t}. ${f.seats
    .map((s) => `seat ${s.n} ${s.bookedBy.length > 1 ? `double booked by ${s.bookedBy.join(' and ')}` : s.bookedBy.length ? `booked by ${s.bookedBy[0]}` : s.holdBy ? `held by ${s.holdBy}` : 'available'}`)
    .join(', ')}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Guard>
            label="Booking flow"
            value={params.guard}
            options={[
              { value: 'naive', label: 'Naive read-then-write' },
              { value: 'atomic', label: 'Atomic hold + guarded confirm' },
            ]}
            onChange={(guard) => setParams((p) => ({ ...p, guard }))}
          />
          <Slider label="Hold TTL" value={params.ttl} min={3} max={8} onChange={(ttl) => setParams((p) => ({ ...p, ttl }))} format={(v) => `${v} ticks`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} /> available
          <span className="viz-key" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} /> held (lease with TTL)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> booked
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> sold twice
        </>
      }
    >
      <svg viewBox="0 0 600 300" className="viz-svg" role="img" aria-label={aria}>
        <rect x={140} y={8} width={320} height={10} rx={5} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} />
        <text x={300} y={32} textAnchor="middle" fontSize={9.5} style={{ fill: 'var(--muted)' }}>
          screen · show 9, row A
        </text>
        <text x={592} y={18} textAnchor="end" fontSize={12} fontWeight={700}>
          t = {f.t}
        </text>

        {f.seats.map((s, i) => {
          const x = SEAT_X(i);
          const dbl = s.bookedBy.length > 1;
          const booked = s.bookedBy.length === 1;
          const held = !s.bookedBy.length && s.holdBy;
          const touched = f.touched.includes(s.n);
          const fill = dbl ? 'var(--bad)' : booked ? 'var(--good)' : held ? 'var(--warn-soft)' : 'var(--surface)';
          const stroke = touched ? 'var(--accent)' : dbl ? 'var(--bad)' : booked ? 'var(--good)' : held ? 'var(--warn)' : 'var(--border)';
          const left = held && s.holdExp !== null ? Math.max(0, s.holdExp - f.t) : 0;
          return (
            <g key={s.n}>
              <rect x={x} y={44} width={SEAT_W} height={58} rx={10} fill={fill} stroke={stroke} strokeWidth={touched ? 3 : 1.4} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
              <text x={x + SEAT_W / 2} y={64} textAnchor="middle" fontSize={13} fontWeight={700} style={{ fill: dbl || booked ? 'var(--surface)' : 'var(--text)' }}>
                {s.n}
              </text>
              <text x={x + SEAT_W / 2} y={82} textAnchor="middle" fontSize={10} fontWeight={600} style={{ fill: dbl || booked ? 'var(--surface)' : held ? 'var(--warn)' : 'var(--muted)' }}>
                {s.bookedBy.length ? s.bookedBy.join('+') : held ? `held ${s.holdBy}` : 'free'}
              </text>
              {held && s.holdExp !== null && (
                <>
                  <text x={x + SEAT_W / 2} y={96} textAnchor="middle" fontSize={8.5} style={{ fill: 'var(--warn)' }}>
                    ends t={s.holdExp}
                  </text>
                  <rect x={x + 4} y={108} width={SEAT_W - 8} height={4} rx={2} fill="var(--surface-2)" stroke="var(--border)" strokeWidth={0.5} />
                  <rect
                    x={x + 4}
                    y={108}
                    width={((SEAT_W - 8) * Math.min(left, params.ttl)) / params.ttl}
                    height={4}
                    rx={2}
                    fill="var(--warn)"
                    style={{ transition: 'width 0.3s ease' }}
                  />
                </>
              )}
            </g>
          );
        })}

        {f.users.map((u, i) => {
          const x = 8 + i * 148;
          const tone = USER_TONE[u.state];
          return (
            <g key={u.id}>
              <rect
                x={x}
                y={130}
                width={140}
                height={66}
                rx={8}
                fill={tone ? `var(--${tone}-soft)` : 'var(--surface-2)'}
                stroke={tone ? `var(--${tone})` : 'var(--border)'}
                strokeWidth={tone ? 1.8 : 1.2}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              <text x={x + 10} y={150} fontSize={12.5} fontWeight={700}>
                Fan {u.id}
              </text>
              <text x={x + 130} y={150} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: tone ? `var(--${tone})` : 'var(--muted)' }}>
                {u.state}
              </text>
              <text x={x + 10} y={170} className="viz-label" style={{ fontSize: 10.5 }}>
                seats {u.want.join('–')}
              </text>
              <text x={x + 10} y={186} className="viz-label" style={{ fontSize: 10.5 }}>
                {u.note}
              </text>
            </g>
          );
        })}

        <rect
          x={8}
          y={212}
          width={584}
          height={76}
          rx={8}
          fill={f.opOk === false ? 'var(--bad-soft)' : f.opOk ? 'var(--good-soft)' : 'var(--surface-2)'}
          stroke={f.opOk === false ? 'var(--bad)' : f.opOk ? 'var(--good)' : 'var(--border)'}
        />
        <text x={18} y={231} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          {params.guard === 'atomic' ? 'Redis (holds) + Postgres (bookings): last operation' : 'single DB, no guards: last operation'}
        </text>
        <text x={18} y={254} fontSize={11.5} fontFamily="var(--f-mono)">
          {f.op ? (f.op.length > 82 ? `${f.op.slice(0, 80)}…` : f.op) : '—'}
        </text>
        <text x={18} y={277} fontSize={11} fontWeight={700} style={{ fill: f.opOk === false ? 'var(--bad)' : f.opOk ? 'var(--good)' : 'var(--muted)' }}>
          {f.opOk === false ? '✗ rejected or conflicting' : f.opOk ? '✓ succeeded' : ''}
        </text>
      </svg>
    </VizFrame>
  );
}
