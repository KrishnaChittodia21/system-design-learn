import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { SCRIPT, SCRIPT_LEN, simulate, visible, type Page, type PageId, type Params, type SyncCommit, type Tx, type WalRecord } from './sim';

const PAGES: PageId[] = ['A', 'B', 'C'];
const PHASE_LABEL = { run: 'RUNNING', crash: 'POWER LOSS', recover: 'CRASH RECOVERY', done: 'RECOVERED' } as const;
const PHASE_COLOR = { run: 'var(--text-2)', crash: 'var(--bad)', recover: 'var(--warn)', done: 'var(--good)' } as const;

const stepLabel = (k: number) => {
  const s = SCRIPT[k - 1];
  if (!s) return '';
  if (s.kind === 'update') return `T${s.xid} update`;
  if (s.kind === 'commit') return `T${s.xid} commit`;
  if (s.kind === 'checkpoint') return 'checkpoint';
  if (s.kind === 'bgwriter') return 'bgwriter write';
  return 'WAL writer';
};

const walText = (r: WalRecord) => (r.kind === 'update' ? `${r.page} → ${r.value}` : r.kind === 'commit' ? 'COMMIT' : 'CHECKPT');

function PageBox({ x, y, page, label, hot, txs }: { x: number; y: number; page?: Page; label: string; hot: boolean; txs: Tx[] }) {
  const w = 88;
  const h = 76;
  if (!page)
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke="var(--border-strong)" strokeDasharray="4 4" />
        <text x={x + w / 2} y={y + 34} textAnchor="middle" className="viz-label" style={{ fontSize: 11 }}>
          page {label}
        </text>
        <text x={x + w / 2} y={y + 50} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
          not cached
        </text>
      </g>
    );
  const t = txs.find((tx) => tx.xid === page.row.xmin);
  const invisible = page.row.xmin !== 0 && t && t.state === 'aborted';
  const uncommitted = page.row.xmin !== 0 && t && t.state !== 'committed';
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={page.dirty ? 'var(--warn-soft)' : 'var(--surface)'}
        stroke={hot ? 'var(--blue)' : page.dirty ? 'var(--warn)' : 'var(--border-strong)'}
        strokeWidth={hot ? 3 : 1.5}
      />
      <text x={x + 8} y={y + 16} style={{ fontSize: 11.5, fontWeight: 800 }}>
        page {page.id}
      </text>
      <text x={x + w - 8} y={y + 16} textAnchor="end" style={{ fontSize: 9.5, fontWeight: 700, fill: page.dirty ? 'var(--warn)' : 'var(--muted)' }}>
        {page.dirty ? 'DIRTY' : 'clean'}
      </text>
      <text x={x + 8} y={y + 33} style={{ fontSize: 11, fontFamily: 'var(--f-mono)', fill: uncommitted ? 'var(--warn)' : 'var(--text)' }}>
        <tspan style={{ textDecoration: invisible ? 'line-through' : undefined }}>bal {page.row.value}</tspan>
        {invisible && <tspan style={{ fill: 'var(--good)', fontWeight: 700 }}> {visible(page.row, txs)}</tspan>}
      </text>
      <text x={x + 8} y={y + 48} className="viz-label" style={{ fontSize: 10, fontFamily: 'var(--f-mono)' }}>
        {invisible ? `T${page.row.xmin} aborted` : `xmin ${page.row.xmin || '—'}`}
      </text>
      <text x={x + 8} y={y + 64} className="viz-label" style={{ fontSize: 10, fontFamily: 'var(--f-mono)' }}>
        pd_lsn {page.lsn}
      </text>
    </g>
  );
}

export default function PgWalCrashRecoveryViz() {
  const [params, setParams] = useState<Params>({ sync: 'on', crashAfter: SCRIPT_LEN });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const cellW = 56;
  const cellGap = 2;
  const walX = (k: number) => 8 + k * (cellW + cellGap);
  const crashed = f.phase !== 'run';
  // after the crash keep drawing the WAL as it was, so the lost records stay visible
  const preCrash = frames.filter((x) => x.phase === 'run').at(-1)!;
  const walCells = crashed ? preCrash.wal : f.wal;
  const flushedIdx = walCells.filter((r) => r.lsn <= f.flushed).length;
  const redoIdx = walCells.findIndex((r) => r.lsn >= f.redo);

  const txStatus = (t: Tx): { text: string; color: string } => {
    if (f.phase === 'run') return t.state === 'committed' ? { text: 'COMMIT acked', color: 'var(--good)' } : { text: 'in progress', color: 'var(--blue)' };
    if (f.phase === 'done') {
      if (t.state === 'committed') return { text: 'committed', color: 'var(--good)' };
      return t.acked ? { text: 'LOST (was acked)', color: 'var(--bad)' } : { text: 'aborted', color: 'var(--muted)' };
    }
    return t.state === 'committed' ? { text: 'committed', color: 'var(--good)' } : { text: 'unknown yet', color: 'var(--warn)' };
  };

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<SyncCommit>
            label="synchronous_commit"
            value={params.sync}
            options={[
              { value: 'on', label: 'on (wait for WAL fsync)' },
              { value: 'off', label: 'off (ack before fsync)' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, sync: v }))}
          />
          <Slider
            label="Pull the plug after step"
            value={params.crashAfter}
            min={1}
            max={SCRIPT_LEN}
            onChange={(v) => setParams((p) => ({ ...p, crashAfter: v }))}
            format={(v) => `${v} (${stepLabel(v)})`}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--blue)' }} /> only in memory (WAL buffers)
          <span className="viz-key" style={{ background: 'var(--border-strong)' }} /> fsynced to pg_wal
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> dirty page / not yet committed
          <span className="viz-key" style={{ background: 'var(--good)' }} /> replayed / committed
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> lost in the crash
          <span>+FPI = record carries a full-page image</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 316"
        className="viz-svg"
        role="img"
        aria-label={`${PHASE_LABEL[f.phase]}: ${f.action}. WAL flushed to LSN ${f.flushed}, redo point LSN ${f.redo}. ${f.txs.map((t) => `T${t.xid} ${txStatus(t).text}`).join(', ')}.`}
      >
        <text x={8} y={16} className="viz-label">
          WAL, in LSN order · redo point LSN {f.redo} · fsynced up to LSN {f.flushed}
        </text>
        <text x={592} y={16} textAnchor="end" style={{ fontSize: 12, fontWeight: 800, fill: PHASE_COLOR[f.phase] }}>
          {PHASE_LABEL[f.phase]}
        </text>

        {/* WAL tape */}
        {walCells.length === 0 && (
          <text x={8} y={56} className="viz-label">
            (empty)
          </text>
        )}
        {walCells.map((r, k) => {
          const x = walX(k);
          const lost = f.lost.includes(r.lsn);
          const onDisk = r.lsn <= f.flushed;
          const replayed = f.replayed.includes(r.lsn);
          const cur = f.cursor === r.lsn || f.hot.lsn === r.lsn;
          const stroke = lost ? 'var(--bad)' : replayed ? 'var(--good)' : onDisk ? 'var(--border-strong)' : 'var(--blue)';
          const fill = lost ? 'var(--bad-soft)' : replayed ? 'var(--good-soft)' : onDisk ? 'var(--surface)' : 'var(--blue-s)';
          return (
            <g key={r.lsn}>
              <rect x={x} y={30} width={cellW} height={52} rx={6} fill={fill} stroke={cur ? 'var(--blue)' : stroke} strokeWidth={cur ? 3 : 1.5} strokeDasharray={onDisk || lost ? undefined : '4 3'} />
              <text x={x + cellW / 2} y={45} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-2)' }}>
                LSN {r.lsn}
              </text>
              <text x={x + cellW / 2} y={60} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, textDecoration: lost ? 'line-through' : undefined }}>
                {walText(r)}
              </text>
              <text x={x + cellW / 2} y={75} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: lost ? 'var(--bad)' : 'var(--muted)' }}>
                {lost ? 'LOST' : `${r.xid ? `T${r.xid}` : ''}${r.fpi ? ' +FPI' : ''}`}
              </text>
            </g>
          );
        })}
        {redoIdx >= 0 && (
          <g>
            <path d={`M${walX(redoIdx) + 4},96 l6,-9 l6,9 z`} fill="var(--warn)" />
            <text x={walX(redoIdx) + 18} y={96} style={{ fontSize: 10, fontWeight: 700, fill: 'var(--warn)' }}>
              redo point: replay starts here
            </text>
          </g>
        )}
        {flushedIdx > 0 && (
          <line x1={walX(flushedIdx) - cellGap / 2} y1={26} x2={walX(flushedIdx) - cellGap / 2} y2={86} stroke="var(--text)" strokeWidth={2} strokeDasharray="3 2" />
        )}

        {/* buffers vs disk */}
        <text x={8} y={118} className="viz-label">
          shared buffers (RAM){crashed && f.phase === 'crash' ? ' · wiped' : ''}
        </text>
        <text x={310} y={118} className="viz-label">
          data files (disk)
        </text>
        {PAGES.map((p, k) => (
          <PageBox key={`b${p}`} x={8 + k * 96} y={126} page={f.buffers[p]} label={p} hot={f.hot.page === p && f.hot.where === 'buffer'} txs={f.txs} />
        ))}
        {PAGES.map((p, k) => (
          <PageBox key={`d${p}`} x={310 + k * 96} y={126} page={f.disk[p]} label={p} hot={f.hot.page === p && f.hot.where === 'disk'} txs={f.txs} />
        ))}
        <line x1={296} y1={126} x2={296} y2={202} stroke="var(--border)" />

        {/* transactions */}
        <text x={8} y={224} className="viz-label">
          transactions (what the client was told → what the database knows)
        </text>
        {f.txs.length === 0 && (
          <text x={8} y={252} className="viz-label">
            none yet
          </text>
        )}
        {f.txs.map((t, k) => {
          const s = txStatus(t);
          const x = 8 + k * 117;
          return (
            <g key={t.xid}>
              <rect x={x} y={232} width={111} height={44} rx={8} fill="var(--surface)" stroke={s.color} strokeWidth={1.8} />
              <text x={x + 8} y={250} style={{ fontSize: 12, fontWeight: 800 }}>
                T{t.xid}
                <tspan style={{ fontSize: 9.5, fontWeight: 600, fill: 'var(--muted)' }}>{t.acked ? '  client: OK' : ''}</tspan>
              </text>
              <text x={x + 8} y={268} style={{ fontSize: 10.5, fontWeight: 700, fill: s.color }}>
                {s.text}
              </text>
            </g>
          );
        })}
        <text x={8} y={302} className="viz-label">
          step {Math.min(f.step, SCRIPT_LEN)}/{SCRIPT_LEN}: <tspan style={{ fontWeight: 700, fill: 'var(--text)' }}>{f.action}</tspan>
        </text>
      </svg>
    </VizFrame>
  );
}
