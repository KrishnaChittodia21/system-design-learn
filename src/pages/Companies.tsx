// Company track: the list of reported company questions (unlocked after every topic exam is passed)
// and the timed mock-interview page for one question, revealed stage by stage.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Lock, LockOpen, Pause, Play, RotateCcw } from 'lucide-react';
import { COMPANIES, COMPANY_QUESTIONS, TOPICS, TOPIC_BY_ID } from '../content';
import { setDraft, setFlag, setSettings, useProgress } from '../lib/progress';
import { companyUnlocked } from '../lib/stats';
import { Diagram, Markdown, Reveal, formatClock } from '../components/ui';
import type { CompanyQuestion } from '../types';

const FREQ: Record<CompanyQuestion['frequency'], { label: string; tone: string }> = {
  'very-high': { label: 'Very high frequency', tone: 'rose' },
  high: { label: 'High frequency', tone: 'amber' },
  medium: { label: 'Medium frequency', tone: 'blue' },
};

const initial = (name: string) => name.trim().charAt(0).toUpperCase();

/* ---------- locked state ---------- */
function Locked() {
  const p = useProgress();
  const { remaining } = companyUnlocked(p, TOPICS);
  const done = TOPICS.length - remaining.length;
  const pct = Math.round((done / Math.max(1, TOPICS.length)) * 100);
  return (
    <div className="page co-page co-locked">
      <section className="co-lock-hero glass holo" aria-labelledby="co-lock-h">
        <div className="co-hero-glow" aria-hidden />
        <div className="co-lock-text">
          <span className="nb-chip">
            <Lock size={12} aria-hidden /> Final track · locked
          </span>
          <h1 id="co-lock-h">
            <span className="gtext">Company track</span>
          </h1>
          <p className="lede">
            {COMPANY_QUESTIONS.length} reported system design questions from {COMPANIES.length} companies, each with a timed mock-interview mode. It
            unlocks after you pass <strong>every</strong> topic exam (full length, ≥ {p.settings.passMark}%).
          </p>
        </div>
        <div className="co-lock-ring" role="img" aria-label={`${done} of ${TOPICS.length} exams passed`}>
          <div className="nb-ring" style={{ ['--rw' as string]: '10px', background: 'var(--tint)' }} />
          <div
            className="nb-ring co-ring-fill"
            style={{ ['--rw' as string]: '10px', background: `conic-gradient(var(--cyan), var(--blue) ${pct / 2}%, var(--amber) ${pct}%, transparent ${pct}%)` }}
          />
          <div className="co-ring-c">
            <div className="num">
              {done}
              <span>/{TOPICS.length}</span>
            </div>
            <div className="eyebrow">exams passed</div>
          </div>
        </div>
      </section>

      <div className="co-cos co-cos-locked" role="group" aria-label="Companies in the track">
        {COMPANIES.map((c) => (
          <span key={c.id} className="co-co">
            <i>{initial(c.name)}</i>
            {c.name}
          </span>
        ))}
      </div>

      <section className="co-remaining glass-flat" aria-labelledby="co-rem-h">
        <div className="co-rem-head">
          <h2 id="co-rem-h">
            Remaining exams <span className="mono">{remaining.length}</span>
          </h2>
          <span className="mono small muted">{pct}% of the way</span>
        </div>
        <div className="track co-rem-track" aria-hidden>
          {pct > 0 && <i className="f-pass" style={{ width: `${pct}%` }} />}
        </div>
        <ul className="co-rem-list">
          {remaining.map((t) => (
            <li key={t.id}>
              <Link to={`/topic/${t.id}?tab=exam`}>
                <span className="co-rem-title">{t.title}</span>
                {p.tests[t.id] && <span className="nb-chip amber">Best {p.tests[t.id].best}%</span>}
                <ChevronRight size={16} aria-hidden className="co-rem-go" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}

/* ---------- list ---------- */
export function CompaniesPage() {
  const p = useProgress();
  const [params, setParams] = useSearchParams();
  const filter = params.get('c') ?? 'all';
  // on phones the company strip scrolls sideways: keep the selected company in view
  const cosRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cosRef.current;
    const cur = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !cur || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2);
  }, [filter]);
  if (!companyUnlocked(p, TOPICS).unlocked) return <Locked />;
  const company = COMPANIES.find((c) => c.id === filter);
  const qs = COMPANY_QUESTIONS.filter((q) => !company || q.company === company.id);
  const doneCount = COMPANY_QUESTIONS.filter((q) => p.company[q.id]).length;
  const pct = Math.round((doneCount / Math.max(1, COMPANY_QUESTIONS.length)) * 100);
  const setFilter = (id: string) => setParams(id === 'all' ? {} : { c: id }, { replace: true });
  return (
    <div className="page co-page">
      <section className="co-list-hero glass holo" aria-labelledby="co-list-h">
        <div className="co-hero-glow" aria-hidden />
        <div className="co-lock-text">
          <span className="nb-chip cyan">
            <LockOpen size={12} aria-hidden /> Final track · unlocked
          </span>
          <h1 id="co-list-h">
            <span className="gtext">Company-specific system design</span>
          </h1>
          <p className="lede">Pick a company to see its interview style, then run a timed mock.</p>
        </div>
        <div className="co-list-stat">
          <div className="num">
            {doneCount}
            <span>/{COMPANY_QUESTIONS.length}</span>
          </div>
          <div className="eyebrow">completed</div>
          <div className="track" aria-hidden>
            {pct > 0 && <i className="f-pass" style={{ width: `${pct}%` }} />}
          </div>
        </div>
      </section>

      <div className="co-cos co-cos-filter" role="group" aria-label="Filter by company" ref={cosRef}>
        <button type="button" className="co-co" aria-pressed={!company} onClick={() => setFilter('all')}>
          <i>★</i>All
        </button>
        {COMPANIES.map((c) => (
          <button key={c.id} type="button" className="co-co" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
            <i>{initial(c.name)}</i>
            {c.name}
          </button>
        ))}
      </div>

      {company && (
        <section className="co-info glass-flat" aria-label={`${company.name} interview style`}>
          <span className="co-avatar lg" aria-hidden>
            {initial(company.name)}
          </span>
          <div>
            <h2>{company.name}</h2>
            <p>
              <span className="eyebrow">Focus</span> {company.focus}
            </p>
            <p>
              <span className="eyebrow">Interview style</span> {company.interviewStyle}
            </p>
          </div>
        </section>
      )}

      <ul className="co-qlist" aria-label={`${qs.length} question${qs.length === 1 ? '' : 's'}`}>
        {qs.map((q) => {
          const c = COMPANIES.find((x) => x.id === q.company);
          const done = !!p.company[q.id];
          const f = FREQ[q.frequency];
          return (
            <li key={q.id}>
              <Link to={`/companies/${q.id}`} className={`co-qrow glass-flat ${done ? 'done' : ''} f-${q.frequency}`}>
                <span className="co-avatar" aria-hidden>
                  {initial(c?.name ?? q.company)}
                </span>
                <span className="co-q-main">
                  <span className="co-q-meta mono">
                    {c?.name ?? q.company} · {q.level}
                  </span>
                  <span className="co-q-title">{q.title}</span>
                  <span className="co-q-prompt">{q.prompt}</span>
                </span>
                <span className={`nb-chip ${f.tone} co-q-freq`}>{f.label}</span>
                <span className="co-q-state">
                  {done ? (
                    <span className="nb-chip cyan">
                      <Check size={12} aria-hidden /> Done
                    </span>
                  ) : (
                    <span className="co-q-go" aria-hidden>
                      <ArrowRight size={16} />
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- one question: mock interview ---------- */
const STAGES = [
  'Clarifying questions',
  'Requirements',
  'Estimation',
  'High-level design',
  'Deep dives',
  'Trade-offs',
  'Follow-ups',
] as const;

/** Split an estimation line around its final result (after the last ≈ / =, up to a following ";", "→" or "("), which is emphasised. */
function splitCalc(calc: string): [string, string, string] {
  const at = Math.max(calc.lastIndexOf('≈'), calc.lastIndexOf('='));
  if (at <= 0 || at > calc.length - 2) return [calc, '', ''];
  const rest = calc.slice(at);
  const stop = rest.slice(2).search(/;|→| \(/);
  const end = stop < 0 ? rest.length : stop + 2;
  const result = rest.slice(0, end).trimEnd();
  return [calc.slice(0, at), result, rest.slice(result.length)];
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function CompanyQuestionPage() {
  const { qid = '' } = useParams();
  const p = useProgress();
  const q = COMPANY_QUESTIONS.find((x) => x.id === qid);
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(p.settings.mockMinutes * 60);
  const deadline = useRef(0);
  const scrollTo = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const l = Math.round((deadline.current - Date.now()) / 1000);
      setLeft(l);
      if (l <= 0) setRunning(false);
    }, 250);
    return () => clearInterval(t);
  }, [running]);

  // the company strip scrolls sideways: start it at this question's company
  const cosRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = cosRef.current;
    const cur = el?.querySelector<HTMLElement>('[aria-current]');
    if (!el || !cur || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2);
  }, [qid]);

  // after a reveal, bring the newly revealed stage into view
  useEffect(() => {
    const n = scrollTo.current;
    if (n === null) return;
    scrollTo.current = null;
    document.getElementById(`co-s${n}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [stage]);

  if (!companyUnlocked(p, TOPICS).unlocked) return <Locked />;
  if (!q) return <div className="page">Question not found</div>;
  const company = COMPANIES.find((c) => c.id === q.company);
  const siblings = COMPANY_QUESTIONS.filter((x) => x.company === q.company);
  const pos = siblings.findIndex((x) => x.id === q.id) + 1;
  const draftKey = `co:${q.id}`;
  const done = !!p.company[q.id];
  const total = p.settings.mockMinutes * 60;
  const f = FREQ[q.frequency];

  const startTimer = () => {
    const secs = left > 0 ? left : total;
    deadline.current = Date.now() + secs * 1000;
    setLeft(secs);
    setRunning(true);
  };
  /** reveal up to stage n (1-based) */
  const reveal = (n: number) => {
    if (n <= stage) {
      document.getElementById(`co-s${n}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    scrollTo.current = n;
    setStage(n);
  };

  const frac = Math.min(1, Math.max(0, left / Math.max(1, total)));
  const urgent = running && left <= 300;
  const mins = Math.floor(Math.max(0, left) / 60);
  const secs = Math.max(0, left) % 60;

  const whiteboard = (
    <div className="co-board">
      <label htmlFor="co-notes" className="eyebrow">
        Your whiteboard
      </label>
      <textarea
        id="co-notes"
        className="co-notes"
        placeholder="Your whiteboard: requirements → estimation → API → data model → architecture → deep dives → trade-offs"
        value={p.drafts[draftKey] ?? ''}
        onChange={(e) => setDraft(draftKey, e.target.value)}
        rows={8}
      />
    </div>
  );
  const actions = (
    <div className="co-actions">
      {stage < STAGES.length && (
        <button className="btn btn-primary btn-sm" type="button" onClick={() => reveal(stage + 1)}>
          Reveal stage {stage + 1}: {STAGES[stage]}
        </button>
      )}
      <button className={`btn btn-sm ${done ? 'co-done-btn' : ''}`} type="button" onClick={() => setFlag('company', q.id, !done)} aria-pressed={done}>
        {done ? (
          <>
            <Check size={14} aria-hidden /> Completed · mark not done
          </>
        ) : (
          'Mark as completed'
        )}
      </button>
    </div>
  );

  const lockedHint = (i: number) =>
    [
      `${q.clarifyingQuestions.length} questions`,
      `${q.functional.length + q.nonFunctional.length} requirements`,
      `${q.estimation.length} estimation steps`,
      q.diagram ? 'architecture and diagram' : 'architecture',
      `${q.deepDives.length} topic${q.deepDives.length === 1 ? '' : 's'}`,
      `${q.tradeoffs.length} trade-off${q.tradeoffs.length === 1 ? '' : 's'}`,
      `${q.followUps.length} interviewer follow-up${q.followUps.length === 1 ? '' : 's'}`,
    ][i];

  const stageBody = (i: number): ReactNode => {
    switch (i) {
      case 0:
        return (
          <ul className="co-bul">
            {q.clarifyingQuestions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        );
      case 1:
        return (
          <div className="co-cols">
            <div>
              <div className="eyebrow co-sub">Functional</div>
              <ul className="co-bul">
                {q.functional.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="eyebrow co-sub">Non-functional</div>
              <ul className="co-bul">
                {q.nonFunctional.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        );
      case 2:
        return (
          <table className="co-est">
            <caption className="sr-only">Back-of-the-envelope estimation steps</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">Working</th>
              </tr>
            </thead>
            <tbody>
              {q.estimation.map((s, k) => {
                const [work, result, tail] = splitCalc(s.calc);
                return (
                  <tr key={k} style={{ ['--i' as string]: k }}>
                    <th scope="row">{s.label}</th>
                    <td>
                      <code>
                        {work}
                        {result && <b className="co-est-res">{result}</b>}
                        {tail}
                      </code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      case 3:
        return (
          <>
            <div className="co-md">
              <Markdown>{q.highLevelDesign}</Markdown>
            </div>
            {q.diagram && (
              <figure className="co-canvas">
                <Diagram text={q.diagram} />
              </figure>
            )}
          </>
        );
      case 4:
        return (
          <div className="co-dives">
            {q.deepDives.map((d) => (
              <Reveal key={d.topic} label={d.topic} defaultOpen>
                <Markdown>{d.discussion}</Markdown>
              </Reveal>
            ))}
          </div>
        );
      case 5:
        return (
          <ul className="co-bul">
            {q.tradeoffs.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        );
      default:
        return (
          <div className="co-fups">
            {q.followUps.map((fu) => (
              <div key={fu.q} className="co-fup">
                <div className="co-fq">↳ {fu.q}</div>
                <Reveal label="Show answer">
                  <Markdown>{fu.a}</Markdown>
                </Reveal>
              </div>
            ))}
          </div>
        );
    }
  };
  const STAGE_TITLES = [
    'Clarifying questions to ask',
    'Requirements',
    'Back-of-the-envelope',
    'High-level design',
    'Deep dives',
    'Trade-offs to state out loud',
    'Interviewer follow-ups',
  ];

  return (
    <div className="page co-page co-qpage">
      <nav className="co-crumbs" aria-label="Breadcrumb">
        <Link to="/companies">Company track</Link>
        <span aria-hidden>/</span>
        <Link to={`/companies?c=${q.company}`}>{company?.name ?? q.company}</Link>
        <span aria-hidden>/</span>
        <span aria-current="page">
          Question {pos} of {siblings.length}
        </span>
      </nav>

      <nav className="co-cos co-cos-scroll" aria-label="Companies" ref={cosRef}>
        {COMPANIES.map((c) => (
          <Link key={c.id} to={`/companies?c=${c.id}`} className="co-co" aria-current={c.id === q.company ? 'page' : undefined}>
            <i>{initial(c.name)}</i>
            {c.name}
          </Link>
        ))}
      </nav>

      <section className="co-qhead glass holo" aria-labelledby="co-qt">
        <div className="co-hero-glow" aria-hidden />
        <div className="co-qhead-text">
          <div className="co-qchips">
            <span className={`nb-chip ${f.tone}`}>{f.label}</span>
            <span className="nb-chip">{q.level}</span>
            <span className="nb-chip blue">
              {company?.name} · {pos} of {siblings.length}
            </span>
            {done && (
              <span className="nb-chip cyan">
                <Check size={12} aria-hidden /> Done
              </span>
            )}
          </div>
          <h1 id="co-qt">
            <span className="gtext">{q.title}</span>
          </h1>
          <div className="lede co-prompt">
            <Markdown>{q.prompt}</Markdown>
          </div>
        </div>

        <div className="co-timer-col">
          <div
            className={`co-timer ${urgent ? 'urgent' : ''} ${running ? 'running' : ''}`}
            role="timer"
            aria-label={`Mock interview timer: ${mins} minutes ${secs} seconds left of ${p.settings.mockMinutes}`}
          >
            <div className="nb-ring" style={{ ['--rw' as string]: '12px', background: 'var(--tint)' }} />
            <div
              className="nb-ring co-timer-fill"
              style={{
                ['--rw' as string]: '12px',
                background: urgent
                  ? `conic-gradient(var(--rose) ${frac * 100}%, transparent ${frac * 100}%)`
                  : `conic-gradient(var(--cyan), var(--blue) ${frac * 65}%, var(--amber) ${frac * 100}%, transparent ${frac * 100}%)`,
              }}
            />
            <div className="co-timer-dot" style={{ transform: `rotate(${frac * 360}deg)` }} aria-hidden>
              <span className="orbit-dot" />
            </div>
            <div className="co-timer-c">
              <div>
                <div className="mono co-clock">
                  {formatClock(left).split(':').map((part, k, arr) => (
                    <span key={k}>
                      {part}
                      {k < arr.length - 1 && <span className={running ? 'blink' : ''}>:</span>}
                    </span>
                  ))}
                </div>
                <div className="eyebrow">of {p.settings.mockMinutes} min</div>
              </div>
            </div>
          </div>
          <div className="co-timer-ctl">
            {!running ? (
              <button className="btn btn-primary btn-sm" type="button" onClick={startTimer}>
                <Play size={14} aria-hidden /> {left < total && left > 0 ? 'Resume' : 'Start'}
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => setRunning(false)}>
                <Pause size={14} aria-hidden /> Pause
              </button>
            )}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => {
                setRunning(false);
                setLeft(total);
              }}
            >
              <RotateCcw size={14} aria-hidden /> Reset
            </button>
          </div>
          <label className="co-mins">
            <input
              type="number"
              min={5}
              max={120}
              value={p.settings.mockMinutes}
              disabled={running}
              onChange={(e) => {
                const m = Number(e.target.value) || 45;
                setSettings({ mockMinutes: m });
                setLeft(m * 60);
              }}
              aria-label="Mock interview length in minutes"
            />
            <span className="mono small">minutes</span>
          </label>
        </div>
      </section>

      <div className="co-body">
        <aside className="co-srail glass-flat" aria-label="Interview stages">
          <div className="eyebrow">
            Stages · {stage} of {STAGES.length} revealed
          </div>
          <ol>
            {STAGES.map((s, i) => {
              const st = i < stage - 1 ? 'done' : i === stage - 1 ? 'now' : 'locked';
              return (
                <li key={s} className={st}>
                  <button type="button" onClick={() => reveal(i + 1)} aria-current={st === 'now' ? 'step' : undefined}>
                    <span className="n">{st === 'done' ? <Check size={13} aria-hidden /> : i + 1}</span>
                    <span className="co-srail-l">{s}</span>
                    {st === 'locked' && <Lock size={13} aria-hidden className="co-srail-lock" />}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="track co-srail-track" aria-hidden>
            {stage > 0 && <i className="f-pass" style={{ width: `${(stage / STAGES.length) * 100}%` }} />}
          </div>
          <p className="co-srail-tip">Talk through each stage out loud, and compare it with your own answer before you reveal the next one.</p>
        </aside>

        <div className="co-stages">
          {stage === 0 && (
            <section className="gborder co-stage-now" aria-labelledby="co-start-h">
              <div className="in">
                <div className="co-stage-h">
                  <h2 id="co-start-h">
                    <span className="n now">
                      <Play size={13} aria-hidden />
                    </span>
                    Your answer first
                  </h2>
                  <span className="nb-chip amber">
                    <span className="dot pulse-a" style={{ background: 'var(--amber)' }} />
                    Start here
                  </span>
                </div>
                <p className="co-p">
                  Start the timer and sketch your design on the whiteboard. Then reveal the model answer one stage at a time.
                </p>
                {whiteboard}
                {actions}
              </div>
            </section>
          )}

          {STAGES.slice(0, stage).map((_, i) => {
            const isNow = i === stage - 1;
            const head = (
              <h2 id={`co-h${i + 1}`}>
                <span className={`n ${isNow ? 'now' : ''}`}>{i + 1}</span>
                {STAGE_TITLES[i]}
              </h2>
            );
            if (!isNow) {
              return (
                <section key={i} id={`co-s${i + 1}`} className="co-stage glass-flat" aria-labelledby={`co-h${i + 1}`}>
                  {head}
                  {stageBody(i)}
                </section>
              );
            }
            return (
              <section key={i} id={`co-s${i + 1}`} className="gborder co-stage-now" aria-labelledby={`co-h${i + 1}`}>
                <div className="in">
                  <div className="co-stage-h">
                    {head}
                    <span className="nb-chip amber">
                      <span className="dot pulse-a" style={{ background: 'var(--amber)' }} />
                      {stage === STAGES.length ? 'Final stage' : 'Current stage'}
                    </span>
                  </div>
                  {stageBody(i)}
                  {whiteboard}
                  {actions}
                </div>
              </section>
            );
          })}

          {STAGES.slice(stage).map((s, k) => {
            const i = stage + k;
            return (
              <button key={s} type="button" className="co-lockd" onClick={() => reveal(i + 1)}>
                <Lock size={18} aria-hidden />
                <span>
                  <strong>
                    {i + 1} · {STAGE_TITLES[i]}
                  </strong>{' '}
                  — {lockedHint(i)}
                  {k === 0 ? ', revealed next' : ''}
                </span>
              </button>
            );
          })}

          {q.relatedTopics.length > 0 && (
            <section className="co-related glass-flat" aria-labelledby="co-rel-h">
              <h2 id="co-rel-h" className="eyebrow">
                Revise related topics
              </h2>
              <div className="co-rel-chips">
                {q.relatedTopics
                  .map((id) => TOPIC_BY_ID.get(id))
                  .filter((t) => !!t)
                  .map((t) => (
                    <Link key={t!.id} to={`/topic/${t!.id}`} className="chip">
                      {t!.title}
                    </Link>
                  ))}
              </div>
            </section>
          )}
          <Link to="/companies" className="co-back link-btn small">
            ← All company questions
          </Link>
        </div>
      </div>
    </div>
  );
}
