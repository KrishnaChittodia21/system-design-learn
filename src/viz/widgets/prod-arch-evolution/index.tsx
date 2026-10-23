import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { STORIES, type Box, type BoxKind } from './stories';
import { simulate, storyById, type Params } from './sim';
import '../prod-perf-incident-lab/kit/kit.css';
import '../prod-outage-replay/replay.css';
import './evolution.css';

const KIND: Record<BoxKind, { fill: string; stroke: string }> = {
  client: { fill: 'var(--tint)', stroke: 'var(--line-2)' },
  edge: { fill: 'var(--good-soft)', stroke: 'var(--good)' },
  app: { fill: 'var(--accent-soft)', stroke: 'var(--accent)' },
  service: { fill: 'var(--surface)', stroke: 'var(--line-2)' },
  data: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  tool: { fill: 'var(--tint-2)', stroke: 'var(--ink-4)' },
};

const ROW_H = 60;
const BOX_H = 44;

export default function ProdArchEvolution() {
  const [params, setParams] = useState<Params>({ story: STORIES[0].id });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const story = storyById(params.story);
  const era = story.eras[f.era];
  const mainW = era.side ? 430 : 590;
  const H = 16 + era.rows.length * ROW_H;

  const layout = era.rows.map((row, r) => {
    const gap = 12;
    const w = Math.min(220, (mainW - 10 - gap * (row.length - 1)) / row.length);
    const total = w * row.length + gap * (row.length - 1);
    const x0 = 5 + (mainW - 10 - total) / 2;
    return row.map((b, k) => ({ b, x: x0 + k * (w + gap), y: 10 + r * ROW_H, w }));
  });

  const drawBox = ({ b, x, y, w }: { b: Box; x: number; y: number; w: number }) => {
    const k = KIND[b.kind];
    const hot = f.hot.includes(b.id);
    const isNew = f.newIds.includes(b.id);
    return (
      <g key={b.id}>
        <rect x={x} y={y} width={w} height={BOX_H} rx={9} fill="var(--surface)" />
        <rect
          x={x}
          y={y}
          width={w}
          height={BOX_H}
          rx={9}
          fill={hot ? 'var(--bad-soft)' : k.fill}
          stroke={hot ? 'var(--bad)' : isNew ? 'var(--accent)' : k.stroke}
          strokeWidth={hot || isNew ? 2.6 : 1.5}
          style={{ transition: 'fill 0.35s ease, stroke 0.35s ease' }}
        />
        <text x={x + w / 2} y={b.sub ? y + 20 : y + 27} textAnchor="middle" fontSize={w < 120 ? 12 : 14} fontWeight={700}>
          {b.label}
        </text>
        {b.sub && (
          <text x={x + w / 2} y={y + 36} textAnchor="middle" fontSize={w < 120 ? 9.5 : 11} className="viz-label">
            {b.sub}
          </text>
        )}
        {(hot || isNew) && (
          <text x={x + w - 6} y={y - 3} textAnchor="end" fontSize={9.5} fontWeight={700} style={{ fill: hot ? 'var(--bad)' : 'var(--accent)' }}>
            {hot ? 'PRESSURE' : 'NEW'}
          </text>
        )}
      </g>
    );
  };

  // one strip button per era (seek to that era's first frame)
  const eraStart = story.eras.map((_, i) => frames.findIndex((x) => x.era === i && x.mode === 'era'));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Choice<string>
          label="Company"
          value={params.story}
          options={STORIES.map((s) => ({ value: s.id, label: `${s.label} (${s.sections})` }))}
          onChange={(story) => setParams({ story })}
        />
      }
      legend={
        <>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--accent-soft)', border: '2px solid var(--accent)' }} aria-hidden />
            new in this era
          </span>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--bad-soft)', border: '2px solid var(--bad)' }} aria-hidden />
            where the pressure built up
          </span>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--good-soft)', border: '2px solid var(--good)' }} aria-hidden />
            edge / gateway
          </span>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--warn-soft)', border: '2px solid var(--warn)' }} aria-hidden />
            data store
          </span>
        </>
      }
    >
      <ol className="por-strip" aria-label="Eras">
        {story.eras.map((e, i) => (
          <li key={e.id}>
            <button
              type="button"
              className={`por-step ${i === f.era ? 'on' : ''} ${i < f.era ? 'past' : ''}`}
              style={{ ['--por-c' as string]: i === f.era && f.mode === 'pressure' ? 'var(--bad)' : 'var(--accent)' }}
              onClick={() => stepper.seek(eraStart[i])}
              aria-current={i === f.era ? 'step' : undefined}
            >
              <span className="por-time">{e.years}</span>
              <span className="por-phase">{e.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <svg viewBox={`0 0 600 ${H}`} className="viz-svg" role="img" aria-label={`${story.label}, ${era.title}: ${era.rows.map((r) => r.map((b) => b.label).join(' and ')).join(', then ')}.`}>
        <defs>
          <marker id="pae-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-4)" />
          </marker>
        </defs>
        {layout.slice(0, -1).map((row, r) =>
          row.flatMap((a) =>
            layout[r + 1].map((b) => (
              <line
                key={`${a.b.id}-${b.b.id}`}
                x1={a.x + a.w / 2}
                y1={a.y + BOX_H}
                x2={b.x + b.w / 2}
                y2={b.y - 1}
                stroke="var(--ink-4)"
                strokeWidth={1.3}
                markerEnd="url(#pae-arrow)"
                opacity={0.7}
              />
            )),
          ),
        )}
        {layout.flat().map(drawBox)}
        {era.side && (
          <>
            <line x1={mainW - 2} y1={10 + ROW_H + BOX_H / 2} x2={452} y2={10 + ROW_H + BOX_H / 2} stroke="var(--ink-4)" strokeDasharray="4 3" />
            {drawBox({ b: era.side, x: 455, y: 10 + ROW_H, w: 140 })}
          </>
        )}
      </svg>
      {f.mode === 'pressure' && era.pressure ? (
        <p className="pil-note tone-bad">
          <span className="pil-kicker">Pressure that forced the next change</span>
          {era.pressure.text}
        </p>
      ) : f.mode === 'lesson' ? (
        <p className="pil-note tone-good">
          <span className="pil-kicker">Lesson</span>
          {story.lesson}
        </p>
      ) : (
        <div className="pil-note">
          <span className="pil-kicker">
            {era.years} · reported
          </span>
          <ul className="pae-facts">
            {era.facts.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
    </VizFrame>
  );
}
