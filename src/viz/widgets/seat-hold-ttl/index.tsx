import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { SEATS, TTL, simulate, type Event, type Mode, type Params, type Scenario, type User } from './sim';
import './seat.css';

const USER_COLOR: Record<User, string> = { U1: 'var(--blue)', U2: 'var(--mag)', U3: 'var(--amber)' };
const SEAT_W = 64;
const GAP = 8;
const SX = (600 - SEATS.length * SEAT_W - (SEATS.length - 1) * GAP) / 2;
const seatX = (i: number) => SX + i * (SEAT_W + GAP);

function whoColor(who: Event['who']) {
  return who === 'clock' || who === 'redis' ? 'var(--muted)' : USER_COLOR[who];
}

export default function SeatHoldTtlViz() {
  const [params, setParams] = useState<Params>({ mode: 'atomic', scenario: 'late-pay' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const bookedRows = Object.entries(f.booked);
  const recent = f.log.slice(-5);

  const describe = (s: string) => {
    if (f.booked[s]) return `${s} booked by ${f.booked[s]}`;
    const l = f.leases[s];
    if (!l) return `${s} free`;
    return l.expiresAt <= f.now ? `${s} stale lease of ${l.holdId}` : `${s} held by ${l.holdId} until minute ${l.expiresAt}`;
  };
  const ariaLabel = `Minute ${f.now}. ${SEATS.map(describe).join('; ')}. booking_seat rows: ${
    bookedRows.map(([s, u]) => `${s} ${u}`).join(', ') || 'none'
  }.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Story"
            value={params.scenario}
            options={[
              { value: 'late-pay', label: 'Expiry + late payment' },
              { value: 'failover', label: 'Redis loses a key' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Choice<Mode>
            label="Acquire"
            value={params.mode}
            options={[
              { value: 'atomic', label: 'All-or-nothing (topic code)' },
              { value: 'naive', label: 'Seat by seat (naive)' },
            ]}
            onChange={(mode) => setParams((p) => ({ ...p, mode }))}
          />
        </>
      }
      legend={
        <>
          {(Object.keys(USER_COLOR) as User[]).map((u) => (
            <span key={u}>
              <span className="viz-key" style={{ background: USER_COLOR[u], marginRight: 6 }} />
              {u}
            </span>
          ))}
          <span>
            <span className="viz-key" style={{ background: 'transparent', border: '1.5px dashed var(--muted)', borderRadius: 2, marginRight: 6 }} />
            stale lease (expired, not yet swept)
          </span>
          <span>
            <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2, marginRight: 6 }} />
            booked (DB row)
          </span>
        </>
      }
    >
      <svg viewBox="0 0 600 214" className="viz-svg" role="img" aria-label={ariaLabel}>
        <text x={SX} y={16} className="viz-label">
          Hold layer: lease map (Redis / in-memory), TTL {TTL} min
        </text>
        <text x={600 - SX} y={16} textAnchor="end" style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--mono)' }}>
          ⏱ minute {f.now}
        </text>
        {SEATS.map((s, i) => {
          const x = seatX(i);
          const l = f.leases[s];
          const booked = f.booked[s];
          const stale = l && l.expiresAt <= f.now;
          const focus = f.focus.includes(s);
          const owner = booked ?? (l && !stale ? l.holdId : undefined);
          const fill = booked ? 'var(--good-soft)' : owner ? 'var(--surface)' : 'var(--surface-2)';
          const stroke = booked ? 'var(--good)' : owner ? USER_COLOR[owner] : stale ? 'var(--muted)' : 'var(--border)';
          const remain = l && !stale ? Math.max(0, l.expiresAt - f.now) / TTL : 0;
          return (
            <g key={s}>
              {focus && <rect x={x - 4} y={26} width={SEAT_W + 8} height={86} rx={10} fill="var(--accent-soft)" />}
              <rect
                x={x}
                y={30}
                width={SEAT_W}
                height={78}
                rx={8}
                fill={fill}
                stroke={stroke}
                strokeWidth={owner || booked ? 2.4 : 1.4}
                strokeDasharray={stale && !booked ? '5 3' : undefined}
              />
              <text x={x + SEAT_W / 2} y={50} textAnchor="middle" className="viz-node-label">
                {s}
              </text>
              <text
                x={x + SEAT_W / 2}
                y={68}
                textAnchor="middle"
                style={{ fontSize: 11, fontWeight: 700, fill: booked ? 'var(--good)' : owner ? USER_COLOR[owner] : 'var(--muted)' }}
              >
                {booked ? `BOOKED ${booked}` : owner ? `held ${owner}` : stale ? `stale ${l!.holdId}` : 'free'}
              </text>
              {l && !booked && (
                <text x={x + SEAT_W / 2} y={84} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
                  {stale ? `exp ${l.expiresAt}′ (past)` : `exp ${l.expiresAt}′`}
                </text>
              )}
              {l && !stale && !booked && (
                <>
                  <rect x={x + 8} y={94} width={SEAT_W - 16} height={5} rx={2.5} fill="var(--border)" />
                  <rect x={x + 8} y={94} width={(SEAT_W - 16) * remain} height={5} rx={2.5} fill={USER_COLOR[l.holdId]} />
                </>
              )}
            </g>
          );
        })}

        {/* durable layer */}
        <text x={SX} y={136} className="viz-label">
          Durable layer: booking_seat — UNIQUE (show_id, seat_id)
        </text>
        <rect x={SX} y={144} width={600 - 2 * SX} height={22} rx={4} fill="var(--border)" />
        {['show_id', 'seat_id', 'booking (user)'].map((c, i) => (
          <text key={c} x={SX + 10 + i * 170} y={159} style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)' }}>
            {c}
          </text>
        ))}
        {bookedRows.length === 0 && (
          <text x={SX + 10} y={184} className="viz-label">
            (no confirmed rows yet)
          </text>
        )}
        {bookedRows.map(([s, u], k) => (
          <g key={s}>
            <rect x={SX} y={166 + k * 20} width={600 - 2 * SX} height={20} fill="var(--good-soft)" stroke="var(--border)" strokeWidth={0.5} />
            <text x={SX + 10} y={180 + k * 20} style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              S1
            </text>
            <text x={SX + 180} y={180 + k * 20} style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              {s}
            </text>
            <text x={SX + 350} y={180 + k * 20} style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)', fill: USER_COLOR[u] }}>
              {u}
            </text>
          </g>
        ))}
        {f.refunds.length > 0 && (
          <text x={600 - SX} y={136} textAnchor="end" style={{ fontSize: 11.5, fontWeight: 700, fill: 'var(--bad)' }}>
            refunds: {[...new Set(f.refunds)].join(', ')}
          </text>
        )}
      </svg>
      {recent.length > 0 && (
        <ol className="sht-log" aria-label="Recent events">
          {recent.map((e, k) => (
            <li key={f.log.length - recent.length + k} className={k === recent.length - 1 ? 'last' : ''}>
              <span className="sht-t">{e.t}′</span>
              <span className="sht-who" style={{ color: whoColor(e.who) }}>
                {e.who}
              </span>
              <span className={e.ok === true ? 'sht-ok' : e.ok === false ? 'sht-bad' : ''}>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </VizFrame>
  );
}
