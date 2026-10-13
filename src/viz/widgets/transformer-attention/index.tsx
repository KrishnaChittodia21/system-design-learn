import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, K, LABELS, Q, SCALED, V, VOCAB, WK, WQ, WV, X, attention, simulate, type Model, type Params, type Stage } from './sim';

const TX = (i: number) => 22 + i * 116;
const TW = 96;
const TOK_Y = 54;
const CELL = 22;
const ORDER: Stage[] = ['intro', 'embed', 'q', 'k', 'v', 'dot', 'scale', 'mask', 'softmax', 'heat', 'sum', 'logits', 'temp', 'done'];
const after = (s: Stage, t: Stage) => ORDER.indexOf(s) >= ORDER.indexOf(t);
const f2 = (x: number) => (Math.abs(x) < 0.005 ? '0' : x.toFixed(2).replace(/^(-?)0\./, '$1.'));

/** colour a value cell: accent for positive, bad for negative */
function cellFill(v: number, max: number) {
  const a = Math.min(1, Math.abs(v) / max);
  return `color-mix(in srgb, ${v >= 0 ? 'var(--accent)' : 'var(--bad)'} ${Math.round(a * 70)}%, var(--surface))`;
}

function VecCells({ v, x, y, max, hot }: { v: number[]; x: number; y: number; max: number; hot?: boolean }) {
  return (
    <g>
      {v.map((val, k) => (
        <g key={k}>
          <rect x={x + k * CELL} y={y} width={CELL - 1} height={CELL - 1} fill={cellFill(val, max)} stroke={hot ? 'var(--accent)' : 'var(--border)'} strokeWidth={hot ? 1.5 : 0.8} />
          <text x={x + k * CELL + (CELL - 1) / 2} y={y + 14} textAnchor="middle" fontSize={8.5} style={{ fontFamily: 'var(--mono)' }}>
            {f2(val)}
          </text>
        </g>
      ))}
    </g>
  );
}

function Matrix({ M, x, y, title, max, rowLabels, colLabels, hotRow, cell = 26 }: { M: number[][]; x: number; y: number; title: string; max: number; rowLabels?: string[]; colLabels?: string[]; hotRow?: number; cell?: number }) {
  return (
    <g>
      <text x={x} y={y - 6} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        {title}
      </text>
      {colLabels?.map((c, j) => (
        <text key={c + j} x={x + 34 + j * cell + cell / 2} y={y + 8} textAnchor="middle" fontSize={8.5} style={{ fill: 'var(--muted)' }}>
          {c}
        </text>
      ))}
      {M.map((row, i) => (
        <g key={i}>
          {rowLabels && (
            <text x={x + 30} y={y + 14 + (colLabels ? 12 : 0) + i * cell + cell / 2 - 4} textAnchor="end" fontSize={9} fontWeight={i === hotRow ? 700 : 400} style={{ fill: i === hotRow ? 'var(--accent)' : 'var(--text-2)' }}>
              {rowLabels[i]}
            </text>
          )}
          {row.map((v, j) => {
            const masked = v === -Infinity;
            const blank = Number.isNaN(v);
            return (
              <g key={j}>
                <rect
                  x={x + 34 + j * cell}
                  y={y + (colLabels ? 12 : 0) + i * cell}
                  width={cell - 1}
                  height={cell - 1}
                  fill={masked || blank ? 'var(--surface-2)' : cellFill(v, max)}
                  stroke={i === hotRow ? 'var(--accent)' : 'var(--border)'}
                  strokeWidth={i === hotRow ? 1.6 : 0.6}
                />
                <text x={x + 34 + j * cell + (cell - 1) / 2} y={y + (colLabels ? 12 : 0) + i * cell + cell / 2 + 3} textAnchor="middle" fontSize={8.5} style={{ fontFamily: 'var(--mono)', fill: masked ? 'var(--muted)' : 'var(--text)' }}>
                  {blank ? '' : masked ? '−∞' : f2(v)}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </g>
  );
}

export default function TransformerAttentionViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const qi = params.query;
  const dec = params.model === 'decoder';
  const att = attention(params.model);
  const st = f.stage;

  const perToken: number[][] | null = st === 'embed' ? X : st === 'q' ? Q : st === 'k' ? K : st === 'v' || st === 'sum' ? V : null;
  const showScores = after(st, 'dot') && !after(st, 'softmax');
  const showWeights = after(st, 'softmax') && f.weights;

  const aria = `Self-attention for query token ${LABELS[qi]} (${params.model}), step ${st}.${
    f.weights ? ` Weights: ${LABELS.map((l, j) => `${l} ${(f.weights![j] * 100).toFixed(0)}%`).join(', ')}.` : ''
  }${f.probsT ? ` Next token: ${VOCAB[f.probsT.indexOf(Math.max(...f.probsT))]}.` : ''}`;

  const panelY = 196;
  const matForStage: { M: number[][]; title: string; rows?: string[]; cols?: string[]; max: number; hot?: number } | null =
    st === 'q'
      ? { M: WQ, title: 'W_Q (4×4)', max: 3 }
      : st === 'k'
        ? { M: WK, title: 'W_K (identity)', max: 3 }
        : st === 'v'
          ? { M: WV, title: 'W_V (4×4)', max: 3 }
          : st === 'embed'
            ? { M: X, title: 'X = embedding + position', rows: LABELS, cols: ['det', 'noun', 'verb', 'prep'], max: 1.2 }
            : showScores
              ? {
                  M: [SCALED[qi].map((v, j) => (st === 'dot' || st === 'scale' ? (f.raw[j] === null ? NaN : st === 'dot' ? f.raw[j]! : v) : f.masked[j] ? -Infinity : v))],
                  title: st === 'dot' ? 'raw scores q·kⱼ' : st === 'scale' ? 'scaled scores q·kⱼ / √d_k' : 'after causal mask',
                  rows: [LABELS[qi]],
                  cols: LABELS,
                  max: st === 'dot' ? 3.5 : 1.8,
                  hot: 0,
                }
              : after(st, 'softmax')
                ? {
                    M: st === 'softmax' ? att.W.map((r, i) => (i === qi ? r : r.map(() => NaN))) : att.W,
                    title: `attention weights (rows sum to 1)${dec ? ', causal' : ''}`,
                    rows: LABELS,
                    cols: LABELS,
                    max: 1,
                    hot: qi,
                  }
                : null;

  const bars = f.probsT ?? f.probs;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<string>
            label="Query token"
            value={String(qi)}
            options={LABELS.map((l, i) => ({ value: String(i), label: l }))}
            onChange={(v) => setParams((p) => ({ ...p, query: Number(v) }))}
          />
          <Choice<Model>
            label="Model"
            value={params.model}
            options={[
              { value: 'decoder', label: 'Decoder (causal mask)' },
              { value: 'encoder', label: 'Encoder (bidirectional)' },
            ]}
            onChange={(model) => setParams((p) => ({ ...p, model }))}
          />
          {dec && <Slider label="Temperature" value={params.temperature} min={0.2} max={2} step={0.1} onChange={(temperature) => setParams((p) => ({ ...p, temperature }))} format={(v) => v.toFixed(1)} />}
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> query token / positive value
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> negative value
          <span className="viz-key" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }} /> masked (−∞ → weight 0)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> attention weight / probability
        </>
      }
    >
      <svg viewBox="0 0 600 350" className="viz-svg" role="img" aria-label={aria}>
        {/* attention arcs */}
        {LABELS.map((_, j) => {
          const w = showWeights ? f.weights![j] : st === 'dot' && f.key === j ? 0.25 : 0;
          if (w < 0.005 || j === qi) return null;
          const x1 = TX(qi) + TW / 2;
          const x2 = TX(j) + TW / 2;
          const peak = Math.min(44, 10 + Math.abs(x2 - x1) * 0.08);
          return (
            <path
              key={j}
              d={`M${x1},${TOK_Y - 2} Q${(x1 + x2) / 2},${TOK_Y - 2 - peak * 2} ${x2},${TOK_Y - 2}`}
              fill="none"
              stroke={showWeights ? 'var(--good)' : 'var(--accent)'}
              strokeWidth={showWeights ? 1 + w * 12 : 1.5}
              strokeDasharray={showWeights ? undefined : '4 3'}
              opacity={showWeights ? 0.35 + w * 0.65 : 0.9}
              style={{ transition: 'stroke-width 0.3s ease' }}
            />
          );
        })}
        {showWeights && f.weights![qi] > 0.005 && (
          <circle cx={TX(qi) + TW / 2} cy={TOK_Y - 12} r={9} fill="none" stroke="var(--good)" strokeWidth={1 + f.weights![qi] * 12} opacity={0.35 + f.weights![qi] * 0.65} />
        )}

        {/* tokens */}
        {LABELS.map((l, j) => {
          const isQ = j === qi;
          const masked = f.masked[j];
          return (
            <g key={j} opacity={masked ? 0.45 : 1} style={{ transition: 'opacity 0.3s ease' }}>
              <rect x={TX(j)} y={TOK_Y} width={TW} height={28} rx={6} fill={isQ ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke={isQ ? 'var(--accent)' : 'var(--border)'} strokeWidth={isQ ? 2.2 : 1.2} strokeDasharray={masked ? '4 3' : undefined} />
              <text x={TX(j) + TW / 2} y={TOK_Y + 19} textAnchor="middle" fontSize={13} fontWeight={700}>
                {l}
              </text>
              {masked && (
                <text x={TX(j) + TW / 2} y={TOK_Y - 6} textAnchor="middle" fontSize={9.5} fontWeight={700} style={{ fill: 'var(--muted)' }}>
                  future: masked
                </text>
              )}
              {/* per-token vector */}
              {perToken && <VecCells v={perToken[j]} x={TX(j) + (TW - 4 * CELL) / 2} y={TOK_Y + 36} max={st === 'q' ? 3 : 1.5} hot={isQ && (st === 'q' || st === 'embed')} />}
              {/* score / weight under token */}
              {showScores && f.raw[j] !== null && !masked && (
                <text x={TX(j) + TW / 2} y={TOK_Y + 52} textAnchor="middle" fontSize={12} fontWeight={700} style={{ fontFamily: 'var(--mono)', fill: f.key === j ? 'var(--accent)' : 'var(--text)' }}>
                  {st === 'dot' ? f.raw[j]!.toFixed(2) : SCALED[qi][j].toFixed(2)}
                </text>
              )}
              {showWeights && (
                <g>
                  <rect x={TX(j) + 8} y={TOK_Y + 62} width={TW - 16} height={10} rx={3} fill="var(--surface-2)" stroke="var(--border)" />
                  <rect x={TX(j) + 8} y={TOK_Y + 62} width={(TW - 16) * f.weights![j]} height={10} rx={3} fill="var(--good)" style={{ transition: 'width 0.3s ease' }} />
                  <text x={TX(j) + TW / 2} y={TOK_Y + 88} textAnchor="middle" fontSize={11} fontWeight={700} style={{ fontFamily: 'var(--mono)' }}>
                    {(f.weights![j] * 100).toFixed(0)}%
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {perToken && (
          <text x={8} y={TOK_Y + 74} className="viz-label" style={{ fontSize: 10 }}>
            {st === 'embed' ? 'x' : st === 'q' ? 'q = x·W_Q' : st === 'k' ? 'k = x·W_K' : 'v = x·W_V'} per token
          </text>
        )}
        {st === 'sum' && (
          <text x={300} y={TOK_Y + 112} textAnchor="middle" fontSize={11} fontWeight={600}>
            z({LABELS[qi]}) = Σ wⱼ·vⱼ = [{att.Z[qi].map(f2).join(', ')}]
          </text>
        )}

        {/* lower-left: matrix for the stage */}
        {matForStage && (
          <Matrix
            M={matForStage.M}
            x={8}
            y={panelY}
            title={matForStage.title}
            max={matForStage.max}
            rowLabels={matForStage.rows ?? ['det', 'noun', 'verb', 'prep']}
            colLabels={matForStage.cols}
            hotRow={matForStage.hot}
            cell={matForStage.M[0].length > 4 ? 25 : 24}
          />
        )}

        {/* lower-right: formula or next-token distribution */}
        {bars ? (
          <g>
            <text x={330} y={panelY - 6} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
              next token after “{LABELS.slice(0, qi + 1).join(' ')}” {f.probsT ? `(T = ${params.temperature.toFixed(1)})` : '(T = 1)'}
            </text>
            {VOCAB.map((w, k) => {
              const y = panelY + 6 + k * 22;
              const p = bars[k];
              const p1 = f.probs![k];
              return (
                <g key={w}>
                  <text x={368} y={y + 12} textAnchor="end" fontSize={11} style={{ fontFamily: 'var(--mono)' }}>
                    {w}
                  </text>
                  <rect x={374} y={y + 2} width={170} height={13} rx={3} fill="var(--surface-2)" />
                  {f.probsT && <rect x={374} y={y + 2} width={170 * p1} height={13} rx={3} fill="none" stroke="var(--text-2)" strokeDasharray="3 2" />}
                  <rect x={374} y={y + 2} width={170 * p} height={13} rx={3} fill="var(--good)" opacity={0.85} style={{ transition: 'width 0.3s ease' }} />
                  <text x={550} y={y + 12} fontSize={10.5} style={{ fontFamily: 'var(--mono)' }}>
                    {(p * 100).toFixed(0)}%
                  </text>
                </g>
              );
            })}
            {f.probsT && (
              <text x={374} y={panelY + 146} className="viz-label" style={{ fontSize: 10 }}>
                dashed = T 1.0 · filled = T {params.temperature.toFixed(1)}
              </text>
            )}
          </g>
        ) : (
          <g>
            <rect x={330} y={panelY - 4} width={262} height={92} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
            <text x={342} y={panelY + 16} fontSize={11} fontWeight={700}>
              Attention(Q, K, V) =
            </text>
            <text x={342} y={panelY + 38} fontSize={12} style={{ fontFamily: 'var(--mono)' }}>
              softmax(QKᵀ/√d_k{dec ? ' + mask' : ''})·V
            </text>
            <text x={342} y={panelY + 60} fontSize={10} style={{ fill: 'var(--text-2)' }}>
              d_k = 4 · 5 tokens · 1 head
            </text>
            <text x={342} y={panelY + 76} fontSize={10} style={{ fill: 'var(--text-2)' }}>
              {dec ? 'decoder: token i sees tokens 1…i' : 'encoder: every token sees all tokens'}
            </text>
          </g>
        )}
      </svg>
    </VizFrame>
  );
}
