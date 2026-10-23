import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, JOBS, T_MAX, simulate, type JobStatus, type Params } from './sim';

const JOB_COLOR: Record<string, string> = { J1: 'var(--accent)', J2: 'var(--cyan)', J3: 'var(--mag)' };
const STATUS_TONE: Record<JobStatus, string> = { PENDING: 'var(--text-2)', RUNNING: 'var(--accent)', RETRY: 'var(--warn)', SUCCEEDED: 'var(--good)' };
const COLS = [
  { k: 'job', x: 16, label: 'job' },
  { k: 'status', x: 58, label: 'status' },
  { k: 'owner', x: 160, label: 'owner' },
  { k: 'token', x: 220, label: 'token' },
  { k: 'lease', x: 280, label: 'lease_until' },
  { k: 'att', x: 368, label: 'attempts' },
  { k: 'next', x: 436, label: 'next_run_at' },
  { k: 'writes', x: 522, label: 'result by' },
];
const TL_X = 46;
const TL_W = (590 - TL_X) / (T_MAX + 1);

export default function JobLeaseFencingViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const aria = `Tick ${Math.max(0, f.t)}. ${f.jobs.map((j) => `${j.id} ${j.status}${j.owner ? ` owned by ${j.owner} token ${j.token}` : ''}`).join('; ')}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Lease length" value={params.lease} min={2} max={6} onChange={(lease) => setParams((p) => ({ ...p, lease }))} format={(v) => `${v} ticks`} />
          <Choice<'on' | 'off'>
            label="Fencing token on the final write"
            value={params.fencing ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, fencing: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          {JOBS.map((j) => (
            <span key={j.id}>
              <span className="viz-key" style={{ marginRight: 4, background: JOB_COLOR[j.id] }} /> {j.id} ({j.work} ticks of work)
            </span>
          ))}
          <span>
            <span className="viz-key" style={{ marginRight: 4, background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} /> GC pause
          </span>
          <span>✓ write accepted · ✗ fenced off</span>
        </>
      }
    >
      <svg viewBox="0 0 600 330" className="viz-svg" role="img" aria-label={aria}>
        {/* job table */}
        <rect x={8} y={6} width={584} height={112} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={16} y={22} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          jobs table (source of truth)
        </text>
        {COLS.map((c) => (
          <text key={c.k} x={c.x} y={40} fontSize={9.5} style={{ fill: 'var(--muted)' }}>
            {c.label}
          </text>
        ))}
        {f.jobs.map((j, i) => {
          const y = 60 + i * 22;
          const claimed = f.claims.find((c) => c.job === j.id);
          const wrote = f.writes.find((w) => w.job === j.id);
          const dup = j.writes.length > 1;
          return (
            <g key={j.id}>
              {(claimed || wrote) && <rect x={12} y={y - 14} width={576} height={20} rx={4} fill={wrote && !wrote.accepted ? 'var(--bad-soft)' : 'var(--accent-soft)'} />}
              <rect x={16} y={y - 9} width={10} height={10} rx={2} fill={JOB_COLOR[j.id]} />
              <text x={30} y={y} fontSize={11} fontWeight={700}>
                {j.id}
              </text>
              <text x={58} y={y} fontSize={11} fontWeight={700} style={{ fill: STATUS_TONE[j.status] }}>
                {j.status}
              </text>
              <text x={160} y={y} fontSize={11}>
                {j.owner ?? '—'}
              </text>
              <text x={220} y={y} fontSize={11} fontWeight={claimed ? 700 : 400}>
                {j.token}
              </text>
              <text x={280} y={y} fontSize={11}>
                {j.leaseUntil ?? '—'}
              </text>
              <text x={368} y={y} fontSize={11}>
                {j.attempts}
              </text>
              <text x={436} y={y} fontSize={11}>
                {j.status === 'RETRY' ? j.nextRunAt : '—'}
              </text>
              <text x={522} y={y} fontSize={10.5} fontWeight={dup ? 700 : 400} style={{ fill: dup ? 'var(--bad)' : 'var(--text)' }}>
                {j.writes.join(', ') || '—'}
              </text>
            </g>
          );
        })}

        {/* workers */}
        {f.workers.map((w, i) => {
          const x = 8 + i * 296;
          const tone = w.paused ? 'warn' : w.job ? 'accent' : undefined;
          const write = f.writes.find((e) => e.worker === w.id);
          return (
            <g key={w.id}>
              <rect
                x={x}
                y={128}
                width={288}
                height={58}
                rx={8}
                fill={write && !write.accepted ? 'var(--bad-soft)' : tone ? `var(--${tone}-soft)` : 'var(--surface-2)'}
                stroke={write && !write.accepted ? 'var(--bad)' : tone ? `var(--${tone})` : 'var(--border)'}
                strokeWidth={tone ? 2 : 1.2}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              <text x={x + 10} y={146} fontSize={12} fontWeight={700}>
                {w.id}
                {w.paused ? ' · GC pause (frozen)' : w.job ? ` · running ${w.job}` : ' · idle, polling'}
              </text>
              <text x={x + 10} y={164} className="viz-label" style={{ fontSize: 10.5 }}>
                {w.job ? `holds token ${w.token} · ${w.remaining} tick${w.remaining === 1 ? '' : 's'} of work left` : 'SELECT … FOR UPDATE SKIP LOCKED'}
              </text>
              <text x={x + 10} y={179} fontSize={10.5} fontWeight={700} style={{ fill: write ? (write.accepted ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                {write
                  ? write.accepted
                    ? `✓ wrote ${write.job} result (token ${write.token})`
                    : `✗ ${write.job} write rejected: token ${write.token} is stale`
                  : w.job && f.jobs.find((j) => j.id === w.job)!.token !== w.token
                    ? `its lease was taken over (row token ${f.jobs.find((j) => j.id === w.job)!.token})`
                    : ''}
              </text>
            </g>
          );
        })}

        {/* timeline */}
        <text x={8} y={210} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          what each worker did per tick
        </text>
        {Array.from({ length: T_MAX + 1 }, (_, t) => (
          <text key={t} x={TL_X + t * TL_W + TL_W / 2} y={226} textAnchor="middle" fontSize={9} fontWeight={t === f.t ? 700 : 400} style={{ fill: t === f.t ? 'var(--accent)' : 'var(--muted)' }}>
            {t}
          </text>
        ))}
        {f.t >= 0 && <rect x={TL_X + f.t * TL_W} y={230} width={TL_W} height={84} rx={3} fill="var(--accent-soft)" />}
        {(['W1', 'W2'] as const).map((w, li) => {
          const y = 236 + li * 38;
          return (
            <g key={w}>
              <text x={8} y={y + 18} fontSize={11} fontWeight={700}>
                {w}
              </text>
              {Array.from({ length: T_MAX + 1 }, (_, t) => {
                const v = f.timeline[w][t];
                const x = TL_X + t * TL_W + 1.5;
                const write = f.t === t ? f.writes.find((e) => e.worker === w) : undefined;
                return (
                  <g key={t}>
                    <rect
                      x={x}
                      y={y}
                      width={TL_W - 3}
                      height={28}
                      rx={4}
                      fill={v === 'pause' ? 'var(--warn-soft)' : v ? JOB_COLOR[v] : 'var(--surface)'}
                      stroke={v === 'pause' ? 'var(--warn)' : v ? 'none' : 'var(--border)'}
                      strokeDasharray={v === 'pause' ? '3 2' : v ? undefined : '2 3'}
                      opacity={v === undefined ? 0.4 : 1}
                    />
                    {v && v !== 'pause' && (
                      <text x={x + (TL_W - 3) / 2} y={y + 18} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--surface)' }}>
                        {v}
                      </text>
                    )}
                    {v === 'pause' && (
                      <text x={x + (TL_W - 3) / 2} y={y + 18} textAnchor="middle" fontSize={9} style={{ fill: 'var(--warn)' }}>
                        GC
                      </text>
                    )}
                    {write && (
                      <text x={x + TL_W - 4} y={y - 1} textAnchor="end" fontSize={12} fontWeight={700} style={{ fill: write.accepted ? 'var(--good)' : 'var(--bad)' }}>
                        {write.accepted ? '✓' : '✗'}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
