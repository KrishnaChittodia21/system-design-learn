import { useState } from 'react';
import { VizFrame, useFrames, type Stepper } from '../../core';
import { meta } from './meta';
import { LPS, STEPS, STORIES, coverage, cycle, defaultTags, type Tags } from './sim';
import './coverage.css';

const NAME_W = 128;
const CW = 28;
const RH = 30;
const Y0 = 44;
const TAG_LABEL = ['not tagged', 'secondary', 'primary'];

export default function LpStoryCoverageViz() {
  const stepper = useFrames(STEPS);
  const [tags, setTags] = useState<Tags>(defaultTags);
  const [editing, setEditing] = useState(STORIES[0].id);
  const n = stepper.frame.n;
  const inBank = STORIES.slice(0, n).map((s) => s.id);
  const cov = coverage(tags, inBank);
  const lpList = (idx: number[]) => idx.map((i) => LPS[i]).join(', ');

  let caption: string;
  if (n === 0) caption = 'An empty bank: all 16 LPs are gaps. Step forward to add the topic’s six example stories one at a time.';
  else {
    const s = STORIES[n - 1];
    const t = tags[s.id];
    const prim = LPS.filter((_, i) => t[i] === 2);
    const sec = LPS.filter((_, i) => t[i] === 1);
    caption = `Added “${s.title}”: primary ${prim.join(', ') || 'none'}${sec.length ? `; secondary ${sec.join(', ')}` : ''}. Gaps ${cov.gaps.length}, one story only ${cov.thin.length}, backed twice ${cov.solid}.`;
    if (n === STORIES.length)
      caption += cov.gaps.length
        ? ` Still uncovered: ${lpList(cov.gaps)}.`
        : ` All 16 are touched, but ${cov.thin.length} rest on a single story, so “another example?” or a repeat across rounds leaves you empty. Aim for 10–12 stories, two per LP.`;
  }
  const view: Stepper = {
    ...stepper,
    frame: { caption, predict: n === 3 ? 'Three stories in. Which LPs do you think are still uncovered?' : undefined },
  };
  const W = NAME_W + LPS.length * CW + 8;
  const H = Y0 + STORIES.length * RH + 46;
  const tone = (c: number) => (c === 0 ? 'bad' : c === 1 ? 'warn' : 'good');
  const ariaLabel = `${n} of ${STORIES.length} stories in the bank. Gaps: ${lpList(cov.gaps) || 'none'}. Only one story: ${lpList(cov.thin) || 'none'}.`;
  const edit = STORIES.find((s) => s.id === editing)!;

  return (
    <VizFrame title={meta.title} blurb={meta.blurb} stepper={view}
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)', borderRadius: 2 }} /> primary LP
          <span className="viz-key ring" style={{ borderColor: 'var(--accent)', borderRadius: 2 }} /> secondary LP
          <span className="viz-key" style={{ background: 'var(--bad)', borderRadius: 2 }} /> gap
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> one story only
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> two or more
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={ariaLabel}>
        <text x={4} y={14} className="viz-label" style={{ fontSize: 10.5 }}>
          story ↓ · LP # →
        </text>
        {LPS.map((lp, i) => (
          <g key={lp}>
            <text x={NAME_W + i * CW + CW / 2} y={34} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 800, fontFamily: 'var(--mono)' }}>
              {i + 1}
              <title>{lp}</title>
            </text>
          </g>
        ))}
        {STORIES.map((s, r) => {
          const y = Y0 + r * RH;
          const active = r < n;
          const latest = r === n - 1;
          return (
            <g key={s.id} opacity={active ? 1 : 0.32}>
              {latest && <rect x={0} y={y} width={W} height={RH} rx={6} fill="var(--accent-soft)" />}
              <text x={6} y={y + 19} style={{ fontSize: 11, fontWeight: 700 }}>
                {s.short}
              </text>
              {LPS.map((lp, i) => {
                const t = tags[s.id][i];
                const cx = NAME_W + i * CW + CW / 2;
                return (
                  <g key={lp}>
                    <rect x={cx - 9} y={y + 6} width={18} height={18} rx={4} fill="none" stroke="var(--border)" strokeWidth={0.6} />
                    {t === 2 && <rect x={cx - 7} y={y + 8} width={14} height={14} rx={3} fill="var(--accent)" />}
                    {t === 1 && <rect x={cx - 6} y={y + 9} width={12} height={12} rx={3} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x={6} y={Y0 + STORIES.length * RH + 24} style={{ fontSize: 11, fontWeight: 800 }}>
          stories per LP
        </text>
        {cov.counts.map((c, i) => {
          const cx = NAME_W + i * CW + CW / 2;
          const y = Y0 + STORIES.length * RH + 8;
          return (
            <g key={i}>
              <rect x={cx - 11} y={y} width={22} height={24} rx={5} fill={`var(--${tone(c)}-soft)`} stroke={`var(--${tone(c)})`} strokeWidth={1.4} />
              <text x={cx} y={y + 16} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 800, fill: `var(--${tone(c)})` }}>
                {c}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="lpc-edit">
        <div className="lpc-row" role="group" aria-label="Story to re-tag">
          <span className="lpc-label">Re-tag a story:</span>
          {STORIES.map((s) => (
            <button key={s.id} type="button" className={`chip lpc-chip ${editing === s.id ? 'on' : ''}`} aria-pressed={editing === s.id} onClick={() => setEditing(s.id)}>
              {s.short}
            </button>
          ))}
          <button type="button" className="chip lpc-chip" onClick={() => setTags(defaultTags())}>
            Reset tags
          </button>
        </div>
        <p className="lpc-hint">
          “{edit.title}”{inBank.includes(edit.id) ? '' : ' (not in the bank yet at this step)'}. Click an LP to cycle not tagged → secondary → primary; a real story usually
          carries 2 primaries and 2–3 secondaries.
        </p>
        <ul className="lpc-lps">
          {LPS.map((lp, i) => {
            const t = tags[edit.id][i];
            return (
              <li key={lp}>
                <button
                  type="button"
                  className={`lpc-lp t${t}`}
                  aria-label={`${i + 1}. ${lp}: ${TAG_LABEL[t]}. Activate to change.`}
                  onClick={() => setTags((all) => ({ ...all, [edit.id]: all[edit.id].map((x, j) => (j === i ? cycle(x) : x)) }))}
                >
                  <span className="lpc-n">{i + 1}</span>
                  <span className="lpc-name">{lp}</span>
                  <span className="lpc-t">{t === 2 ? 'P' : t === 1 ? 'S' : '–'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </VizFrame>
  );
}
