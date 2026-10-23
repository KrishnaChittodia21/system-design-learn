import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DOCS, QUERIES, simulate, type Mode, type Params, type QueryId } from './sim';
import './search.css';

export default function SearchInvertedIndexViz() {
  const [params, setParams] = useState<Params>({ query: 'wh', mode: 'and', b: 0.75, k1: 1.2 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const termsSorted = Object.keys(f.postings).sort();
  const maxScore = Math.max(0.0001, ...(f.ranked ?? []).map((r) => r.total));
  const showQuery = f.phase !== 'docs' && f.phase !== 'index';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<QueryId>
            label="Query"
            value={params.query}
            options={(Object.keys(QUERIES) as QueryId[]).map((q) => ({ value: q, label: QUERIES[q] }))}
            onChange={set('query')}
          />
          <Choice<Mode>
            label="Match"
            value={params.mode}
            options={[
              { value: 'and', label: 'AND (intersect)' },
              { value: 'or', label: 'OR (union)' },
            ]}
            onChange={set('mode')}
          />
          <Slider label="b (length normalisation)" value={params.b} min={0} max={1} step={0.25} onChange={set('b')} />
          <Slider label="k1 (tf saturation)" value={params.k1} min={0.3} max={3} step={0.3} onChange={set('k1')} format={(v) => v.toFixed(1)} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> touched this step
          <span className="viz-key" style={{ background: 'var(--good)' }} /> candidate / match
          <span className="viz-key" style={{ background: 'var(--ink-4)' }} /> stop word (dropped)
        </>
      }
    >
      <div className="sii">
        <section className="sii-panel" aria-label="Documents">
          <h4 className="sii-h">Documents</h4>
          <ol className="sii-docs">
            {DOCS.map((d, i) => {
              const id = i + 1;
              const active = f.activeDoc === id;
              const cand = f.candidates?.includes(id);
              return (
                <li key={id} className={`sii-doc${active ? ' is-active' : ''}${cand ? ' is-cand' : ''}${id > f.indexed && f.phase === 'index' ? ' is-pending' : ''}`}>
                  <span className="sii-id">{id}</span>
                  <span className="sii-text">
                    {active ? (
                      f.tokens.map((t, k) => (
                        <span key={k} className={`sii-tok${t.term ? '' : ' is-stop'}`} title={t.term ? `${t.raw} → ${t.term}` : `${t.raw} (stop word)`}>
                          {t.term && t.term !== t.raw ? (
                            <>
                              {t.raw}
                              <span className="sii-arrow">→{t.term}</span>
                            </>
                          ) : (
                            t.raw
                          )}
                        </span>
                      ))
                    ) : (
                      d
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="sii-panel" aria-label="Inverted index">
          <h4 className="sii-h">
            Term dictionary → postings <span className="sii-sub">doc:tf</span>
          </h4>
          {termsSorted.length === 0 ? (
            <p className="sii-empty">Empty. Step forward to index the documents.</p>
          ) : (
            <ul className="sii-index">
              {termsSorted.map((t) => (
                <li key={t} className={f.hot.includes(t) ? 'is-hot' : ''}>
                  <code className="sii-term">{t}</code>
                  <span className="sii-plist">
                    {f.postings[t].map((p) => (
                      <span key={p.doc} className={`sii-post${f.candidates?.includes(p.doc) && f.hot.includes(t) ? ' is-cand' : ''}`}>
                        {p.doc}:{p.tf}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {showQuery && (
          <section className="sii-panel sii-wide" aria-label="Query evaluation">
            <h4 className="sii-h">
              Query <code>“{QUERIES[params.query]}”</code> → {params.mode.toUpperCase()}
            </h4>
            <div className="sii-qtoks">
              {f.queryTokens.map((t, k) => (
                <span key={k} className={`sii-tok${t.term ? '' : ' is-stop'}`}>
                  {t.raw}
                  {t.term && t.term !== t.raw && <span className="sii-arrow">→{t.term}</span>}
                </span>
              ))}
              {f.candidates && (
                <span className="sii-cands">
                  candidates {'{'}
                  {f.candidates.join(', ')}
                  {'}'}
                </span>
              )}
            </div>
            {f.ranked && f.ranked.length > 0 && (
              <table className="sii-scores">
                <caption className="sii-sub">BM25 contribution per term (avgdl {f.avgdl.toFixed(2)})</caption>
                <thead>
                  <tr>
                    <th scope="col">doc</th>
                    <th scope="col">|d|</th>
                    <th scope="col">terms (tf → score)</th>
                    <th scope="col">total</th>
                  </tr>
                </thead>
                <tbody>
                  {f.ranked.map((r, k) => (
                    <tr key={r.doc} className={f.phase === 'rank' && k === 0 ? 'is-top' : ''}>
                      <td>
                        <span className="sii-id">{r.doc}</span>
                      </td>
                      <td className="sii-num">{r.dl}</td>
                      <td>
                        {r.parts.map((p) => (
                          <span key={p.term} className="sii-part">
                            {p.term} {p.tf}→{p.score.toFixed(2)}
                          </span>
                        ))}
                      </td>
                      <td className="sii-num">
                        <span className="sii-bar" style={{ width: `${(r.total / maxScore) * 100}%` }} aria-hidden />
                        <strong>{r.total.toFixed(2)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </VizFrame>
  );
}
