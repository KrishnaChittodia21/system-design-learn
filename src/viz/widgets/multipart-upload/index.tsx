import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { MAX_PARTS, aggregateMbps, fmtTime, partCount, simulate, type Ending, type Params, type PartState } from './sim';

const MAX_CELLS = 160;
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

type Actor = 'browser' | 'api' | 's3';
const ACTORS: { id: Actor; label: string; x: number }[] = [
  { id: 'browser', label: 'browser', x: 20 },
  { id: 'api', label: 'your API', x: 200 },
  { id: 's3', label: 'S3 bucket', x: 380 },
];

export default function MultipartUploadViz() {
  const [params, setParams] = useState<Params>({ fileGiB: 10, partMiB: 64, streams: 8, fail: true, ending: 'complete' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const n = partCount(params);
  const per = Math.max(1, Math.ceil(n / MAX_CELLS));
  const cells = f.states.length ? Math.ceil(n / per) : 0;
  const cols = Math.min(20, Math.max(1, cells));
  const cellW = Math.min(46, 480 / cols);
  const GX = (520 - cols * cellW) / 2;
  const GY = 108;
  const rows = Math.ceil(cells / cols);
  const H = Math.max(GY + rows * Math.min(cellW, 22) + 50, 210);
  const cellH = Math.min(cellW, 22);

  const cellState = (c: number): { st: PartState; frac: number } => {
    const from = c * per;
    const to = Math.min(n, from + per);
    let done = 0;
    let prog = 0;
    let failed = false;
    let up = false;
    for (let i = from; i < to; i++) {
      if (f.states[i] === 'failed') failed = true;
      if (f.states[i] === 'uploading') up = true;
      if (f.states[i] === 'done') done++;
      prog += f.progress[i];
    }
    const frac = prog / (to - from);
    if (failed) return { st: 'failed', frac };
    if (done === to - from) return { st: 'done', frac: 1 };
    if (up || done > 0) return { st: 'uploading', frac };
    return { st: 'pending', frac: 0 };
  };

  // which arrow is live in the header
  const flow: [Actor, Actor, string] | null =
    f.phase === 'create'
      ? ['api', 's3', 'CreateMultipartUpload → UploadId']
      : f.phase === 'presign'
        ? ['api', 'browser', `${n.toLocaleString('en-US')} presigned part URLs`]
        : f.phase === 'upload'
          ? ['browser', 's3', `PUT parts ×${params.streams} → ETags`]
          : f.phase === 'complete'
            ? ['api', 's3', 'Complete([{part, ETag}…])']
            : null;
  const ax = (a: Actor) => ACTORS.find((x) => x.id === a)!.x + 60;

  const doneCount = f.states.filter((s) => s === 'done').length;
  const aria =
    f.phase === 'invalid'
      ? f.caption
      : `${n} parts, ${doneCount} done, ${f.states.filter((s) => s === 'uploading').length} uploading, ${f.states.filter((s) => s === 'failed').length} failed at ${fmtTime(f.t)}. Object ${f.visible ? 'visible' : 'not visible yet'}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<string> label="File" value={String(params.fileGiB)} options={['1', '10', '50'].map((v) => ({ value: v, label: `${v} GiB` }))} onChange={(v) => set('fileGiB')(Number(v))} />
          <Choice<string> label="Part size" value={String(params.partMiB)} options={['5', '16', '64', '128'].map((v) => ({ value: v, label: `${v} MiB` }))} onChange={(v) => set('partMiB')(Number(v))} />
          <Slider label="Parallel streams" value={params.streams} min={1} max={8} onChange={set('streams')} format={(v) => `${v} (${aggregateMbps(v).toFixed(0)} Mbps)`} />
          <Choice<'fail' | 'ok'> label="Network" value={params.fail ? 'fail' : 'ok'} options={[{ value: 'fail', label: 'one part drops' }, { value: 'ok', label: 'clean' }]} onChange={(v) => set('fail')(v === 'fail')} />
          <Choice<Ending> label="Ending" value={params.ending} options={[{ value: 'complete', label: 'Complete' }, { value: 'abandon', label: 'tab closed' }]} onChange={set('ending')} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)' }} /> pending
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> uploading (fill = progress)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> ETag received
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> connection reset → retry this part only
        </>
      }
    >
      <svg viewBox={`0 0 520 ${H}`} className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="mpu-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {ACTORS.map((a) => (
          <g key={a.id}>
            <rect x={a.x} y={8} width={120} height={30} rx={8} fill="var(--surface)" stroke={a.id === 's3' && f.visible ? 'var(--good)' : 'var(--border-strong)'} strokeWidth={a.id === 's3' && f.visible ? 2 : 1} />
            <text x={a.x + 60} y={28} textAnchor="middle" fontSize={11.5} fontWeight={700}>
              {a.label}
            </text>
          </g>
        ))}
        {flow && (
          <g>
            <line x1={ax(flow[0]) + (ax(flow[1]) > ax(flow[0]) ? 62 : -62)} x2={ax(flow[1]) + (ax(flow[1]) > ax(flow[0]) ? -64 : 64)} y1={flow[0] === 'browser' && flow[1] === 's3' ? 58 : 50} y2={flow[0] === 'browser' && flow[1] === 's3' ? 58 : 50} stroke="var(--accent)" strokeWidth={2} markerEnd="url(#mpu-arr)" />
            <text x={(ax(flow[0]) + ax(flow[1])) / 2} y={flow[0] === 'browser' && flow[1] === 's3' ? 74 : 66} textAnchor="middle" fontSize={10.5} fontWeight={600} style={{ fill: 'var(--accent)', ...halo }}>
              {flow[2]}
            </text>
          </g>
        )}

        {f.phase === 'invalid' ? (
          <g>
            <rect x={40} y={100} width={440} height={70} rx={10} fill="var(--bad-soft)" stroke="var(--bad)" />
            <text x={260} y={128} textAnchor="middle" fontSize={13} fontWeight={700} style={{ fill: 'var(--bad)' }}>
              {n.toLocaleString('en-US')} parts &gt; {MAX_PARTS.toLocaleString('en-US')} limit
            </text>
            <text x={260} y={150} textAnchor="middle" fontSize={11} className="viz-label">
              choose larger parts (max object = part size × 10,000)
            </text>
          </g>
        ) : (
          <g>
            <text x={GX} y={GY - 10} fontSize={10.5} className="viz-label">
              {n.toLocaleString('en-US')} parts × {params.partMiB} MiB{per > 1 ? ` · each cell = ${per} parts` : ''}
            </text>
            {Array.from({ length: cells }, (_, c) => {
              const { st, frac } = cellState(c);
              const x = GX + (c % cols) * cellW;
              const y = GY + Math.floor(c / cols) * cellH;
              return (
                <g key={c}>
                  <rect x={x + 1} y={y + 1} width={cellW - 2} height={cellH - 2} rx={3} fill="var(--surface)" stroke={st === 'failed' ? 'var(--bad)' : 'var(--border)'} strokeWidth={st === 'failed' ? 2 : 1} />
                  {frac > 0 && (
                    <rect
                      x={x + 1}
                      y={y + 1 + (cellH - 2) * (1 - frac)}
                      width={cellW - 2}
                      height={(cellH - 2) * frac}
                      rx={3}
                      fill={st === 'failed' ? 'var(--bad)' : st === 'done' ? 'var(--good)' : 'var(--accent)'}
                      opacity={st === 'done' ? 0.85 : 0.7}
                      style={{ transition: 'y .35s, height .35s' }}
                    />
                  )}
                  {per === 1 && cellW >= 30 && (
                    <text x={x + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" fontSize={10} fontWeight={600}>
                      {c + 1}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={GX} y={GY + rows * cellH + 20} fontSize={11} fontWeight={700}>
              t = {fmtTime(f.t)} · {doneCount.toLocaleString('en-US')}/{n.toLocaleString('en-US')} ETags
              {f.wastedMiB > 0 ? ` · ${f.wastedMiB.toFixed(1)} MiB resent` : ''}
            </text>
            <text x={GX} y={GY + rows * cellH + 36} fontSize={10.5} style={{ fill: f.visible ? 'var(--good)' : f.phase === 'abandon' ? 'var(--bad)' : 'var(--text-2)' }} fontWeight={600}>
              {f.visible ? '✓ object visible in the bucket' : f.phase === 'abandon' ? '✕ parts billed but invisible until aborted' : 'object not visible until Complete'}
            </text>
          </g>
        )}
      </svg>
    </VizFrame>
  );
}
