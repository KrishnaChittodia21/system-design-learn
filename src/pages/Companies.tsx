import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COMPANIES, COMPANY_QUESTIONS, TOPICS, TOPIC_BY_ID } from '../content';
import { setDraft, setFlag, setSettings, useProgress } from '../lib/progress';
import { companyUnlocked } from '../lib/stats';
import { Badge, Diagram, Markdown, ProgressBar, Reveal, formatClock } from '../components/ui';
import { Lock } from 'lucide-react';

function Locked() {
  const p = useProgress();
  const { remaining } = companyUnlocked(p, TOPICS);
  const done = TOPICS.length - remaining.length;
  return (
    <div className="page narrow">
      <h1>
        <Lock size={26} aria-hidden className="inline-icon" /> Company track locked
      </h1>
      <p className="lead">
        This track holds {COMPANY_QUESTIONS.length} reported system design questions from {COMPANIES.length} companies, each with a
        timed mock-interview mode. It unlocks after you pass <strong>every</strong> topic exam (full length, ≥{' '}
        {p.settings.passMark}%).
      </p>
      <div className="card">
        <div className="row between">
          <strong>
            {done}/{TOPICS.length} exams passed
          </strong>
          <span className="muted small">{Math.round((done / Math.max(1, TOPICS.length)) * 100)}%</span>
        </div>
        <ProgressBar value={(done / Math.max(1, TOPICS.length)) * 100} tone="good" />
        <div className="label" style={{ marginTop: 16 }}>
          Remaining exams
        </div>
        <ul className="remaining">
          {remaining.map((t) => (
            <li key={t.id}>
              <Link to={`/topic/${t.id}?tab=exam`}>{t.title}</Link>
              {p.tests[t.id] && <span className="muted small"> · best {p.tests[t.id].best}%</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="company-chips">
        {COMPANIES.map((c) => (
          <span key={c.id} className="chip locked-chip">
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CompaniesPage() {
  const p = useProgress();
  const [filter, setFilter] = useState<string>('all');
  if (!companyUnlocked(p, TOPICS).unlocked) return <Locked />;
  const company = COMPANIES.find((c) => c.id === filter);
  const qs = COMPANY_QUESTIONS.filter((q) => filter === 'all' || q.company === filter);
  const doneCount = COMPANY_QUESTIONS.filter((q) => p.company[q.id]).length;
  return (
    <div className="page">
      <div className="eyebrow">Final track</div>
      <h1>Company-specific system design</h1>
      <p className="lead">
        {doneCount}/{COMPANY_QUESTIONS.length} completed. Pick a company to see its interview style, then run a timed mock.
      </p>
      <div className="company-chips">
        <button type="button" className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        {COMPANIES.map((c) => (
          <button key={c.id} type="button" className={`chip ${filter === c.id ? 'on' : ''}`} onClick={() => setFilter(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      {company && (
        <div className="card info">
          <h3>{company.name}</h3>
          <p>
            <strong>Focus:</strong> {company.focus}
          </p>
          <p>
            <strong>Interview style:</strong> {company.interviewStyle}
          </p>
        </div>
      )}
      <div className="card-grid">
        {qs.map((q) => {
          const c = COMPANIES.find((x) => x.id === q.company);
          return (
            <Link key={q.id} to={`/companies/${q.id}`} className={`topic-card ${p.company[q.id] ? 'st-passed' : ''}`}>
              <div className="topic-card-top">
                <Badge tone="tag">{c?.name ?? q.company}</Badge>
                <Badge tone={q.frequency === 'very-high' ? 'expert' : q.frequency === 'high' ? 'hard' : 'medium'}>
                  {q.frequency.replace('-', ' ')}
                </Badge>
              </div>
              <h3>{q.title}</h3>
              <p className="muted small">{q.prompt}</p>
              <div className="topic-card-foot">
                <span className="small muted">{q.level}</span>
                {p.company[q.id] && <span className="small status-pill st-passed">Done</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const STAGES = [
  'Clarifying questions',
  'Requirements',
  'Estimation',
  'High-level design',
  'Deep dives',
  'Trade-offs',
  'Follow-ups',
] as const;

export function CompanyQuestionPage() {
  const { qid = '' } = useParams();
  const p = useProgress();
  const q = COMPANY_QUESTIONS.find((x) => x.id === qid);
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(p.settings.mockMinutes * 60);
  const deadline = useRef(0);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const l = Math.round((deadline.current - Date.now()) / 1000);
      setLeft(l);
      if (l <= 0) setRunning(false);
    }, 250);
    return () => clearInterval(t);
  }, [running]);

  if (!companyUnlocked(p, TOPICS).unlocked) return <Locked />;
  if (!q) return <div className="page">Question not found</div>;
  const company = COMPANIES.find((c) => c.id === q.company);
  const draftKey = `co:${q.id}`;
  const done = !!p.company[q.id];

  const startTimer = () => {
    const secs = left > 0 ? left : p.settings.mockMinutes * 60;
    deadline.current = Date.now() + secs * 1000;
    setLeft(secs);
    setRunning(true);
  };

  return (
    <div className="page">
      <Link to="/companies" className="muted small">
        ← All company questions
      </Link>
      <div className="eyebrow">
        {company?.name} · {q.level}
      </div>
      <h1>{q.title}</h1>
      <div className="card prompt-card">
        <Markdown>{q.prompt}</Markdown>
      </div>

      <div className="card mock-bar">
        <div>
          <strong>Mock interview timer</strong>
          <div className="row gap-s">
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
            />
            <span className="muted small">minutes</span>
          </div>
        </div>
        <div className={`timer ${left <= 300 && running ? 'urgent' : ''}`}>{formatClock(left)}</div>
        <div className="row gap-s">
          {!running ? (
            <button className="btn btn-primary" type="button" onClick={startTimer}>
              {left < p.settings.mockMinutes * 60 && left > 0 ? 'Resume' : 'Start'}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => setRunning(false)}>
              Pause
            </button>
          )}
          <button
            className="btn-ghost"
            type="button"
            onClick={() => {
              setRunning(false);
              setLeft(p.settings.mockMinutes * 60);
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <textarea
        className="answer-box tall"
        placeholder="Your whiteboard: requirements → estimation → API → data model → architecture → deep dives → trade-offs"
        value={p.drafts[draftKey] ?? ''}
        onChange={(e) => setDraft(draftKey, e.target.value)}
        rows={12}
      />

      <div className="stage-bar">
        {STAGES.map((s, i) => (
          <button key={s} type="button" className={`stage ${i < stage ? 'done' : ''}`} onClick={() => setStage(i + 1)}>
            {i + 1}. {s}
          </button>
        ))}
      </div>
      <p className="muted small">Reveal stages one at a time and compare each with your own answer before moving on.</p>

      {stage >= 1 && (
        <div className="card">
          <h3>1. Clarifying questions to ask</h3>
          <ul>
            {q.clarifyingQuestions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {stage >= 2 && (
        <div className="card two-col">
          <div>
            <h3>2. Functional requirements</h3>
            <ul>
              {q.functional.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Non-functional requirements</h3>
            <ul>
              {q.nonFunctional.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {stage >= 3 && (
        <div className="card">
          <h3>3. Back-of-the-envelope</h3>
          <ol className="steps">
            {q.estimation.map((s, i) => (
              <li key={i}>
                <span className="step-label">{s.label}</span>
                <code className="step-calc">{s.calc}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
      {stage >= 4 && (
        <div className="card">
          <h3>4. High-level design</h3>
          <Markdown>{q.highLevelDesign}</Markdown>
          {q.diagram && <Diagram text={q.diagram} />}
        </div>
      )}
      {stage >= 5 && (
        <div className="card">
          <h3>5. Deep dives</h3>
          {q.deepDives.map((d) => (
            <Reveal key={d.topic} label={d.topic} defaultOpen>
              <Markdown>{d.discussion}</Markdown>
            </Reveal>
          ))}
        </div>
      )}
      {stage >= 6 && (
        <div className="card">
          <h3>6. Trade-offs to state out loud</h3>
          <ul>
            {q.tradeoffs.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {stage >= 7 && (
        <div className="card">
          <h3>7. Interviewer follow-ups</h3>
          {q.followUps.map((f) => (
            <div key={f.q} className="followup">
              <div className="fq">↳ {f.q}</div>
              <Reveal label="Show answer">
                <Markdown>{f.a}</Markdown>
              </Reveal>
            </div>
          ))}
        </div>
      )}

      <div className="row gap-s wrap">
        {stage < STAGES.length && (
          <button className="btn" type="button" onClick={() => setStage((s) => s + 1)}>
            Reveal: {STAGES[stage]}
          </button>
        )}
        <button className={`btn ${done ? '' : 'btn-primary'}`} type="button" onClick={() => setFlag('company', q.id, !done)}>
          {done ? 'Mark not done' : 'Mark as completed'}
        </button>
      </div>

      {q.relatedTopics.length > 0 && (
        <div className="card">
          <div className="label">Revise related topics</div>
          <div className="row wrap gap-s">
            {q.relatedTopics
              .map((id) => TOPIC_BY_ID.get(id))
              .filter((t) => !!t)
              .map((t) => (
                <Link key={t!.id} to={`/topic/${t!.id}`} className="chip">
                  {t!.title}
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
