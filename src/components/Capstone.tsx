import { useCallback, useEffect, useState } from 'react';
import type { CapstoneProject } from '../types';
import { Check, CircleCheck, Hammer, RefreshCw, X } from 'lucide-react';
import { CodeBlock, Markdown, ProgressBar } from './ui';
import { celebrate } from '../lib/celebrate';
import { claimCelebration } from '../lib/uiPrefs';

interface TestResult {
  name: string;
  ok: boolean;
  message?: string;
}
interface ProjectResult {
  passed: number;
  failed: number;
  total: number;
  ranAt: string;
  tests: TestResult[];
}

/** Results written by `npm run project -- <id>`, served from public/project-results.json. */
function useProjectResults(active: boolean) {
  const [results, setResults] = useState<Record<string, ProjectResult>>({});
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}project-results.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) setResults((await res.json()) as Record<string, ProjectResult>);
    } catch {
      // file missing or app opened from a static host: just show "not run yet"
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [active, load]);
  return { results, loaded, reload: load };
}

export function CapstoneTab({ projects }: { projects: CapstoneProject[] }) {
  const { results, reload } = useProjectResults(true);
  return (
    <div className="tp-stack">
      <div className="tp-intro info">
        <strong>Build it, then get it judged.</strong> Each capstone is a real project in this repo. Write your implementation in
        your editor and run its test suite. The tests are the judge, and the results appear here automatically. Read the tests
        if you are stuck, but don&apos;t change them. A reference solution is in <code className="inline-code">solution/</code>{' '}
        for after you&apos;ve tried.
      </div>
      {projects.map((p, i) => (
        <ProjectCard key={p.id} p={p} n={i + 1} of={projects.length} result={results[p.id]} onRefresh={reload} />
      ))}
    </div>
  );
}

const DIFF_TONE = { medium: 'blue', hard: 'amber', expert: 'rose' } as const;

function ProjectCard({
  p,
  n,
  of,
  result,
  onRefresh,
}: {
  p: CapstoneProject;
  n: number;
  of: number;
  result?: ProjectResult;
  onRefresh: () => void;
}) {
  const pct = result && result.total ? Math.round((result.passed / result.total) * 100) : 0;
  const done = !!result && result.total > 0 && result.passed === result.total;
  // celebrate the first time this project's judge reports every test passing
  useEffect(() => {
    if (done && claimCelebration(`capstone:${p.id}`)) celebrate(`Capstone complete: ${p.title}`, 'Every judge test passes.');
  }, [done, p.id, p.title]);
  return (
    <article id={`capstone-${p.id}`} className={`tp-card capstone ${done ? 'capstone-done' : ''}`} aria-labelledby={`cap-${p.id}`}>
      <div className="tp-card-top">
        <span className="eyebrow tp-eb-amber">
          <Hammer size={13} aria-hidden /> Capstone {n} of {of}
        </span>
        <span className="tp-chips">
          <span className={`nb-chip ${DIFF_TONE[p.difficulty]}`}>{p.difficulty}</span>
          <span className="nb-chip">~{p.estimatedHours} h</span>
          {done && <span className="nb-chip cyan">Complete</span>}
        </span>
      </div>
      <h2 id={`cap-${p.id}`} className="tp-card-title">
        {p.title}
      </h2>
      <Markdown>{p.summary}</Markdown>

      <div className="tp-label">Milestones the tests check</div>
      <ol className="tp-numlist milestones">
        {p.milestones.map((m) => (
          <li key={m.name}>
            <div>
              <strong>{m.name}</strong>
              <Markdown>{m.description}</Markdown>
            </div>
          </li>
        ))}
      </ol>

      <div className="tp-label">How to build and get judged</div>
      <CodeBlock
        snippet={{
          language: 'bash',
          title: 'from the repository root',
          code: `# 1. implement your solution in:\n${p.files.map((f) => `#    projects/${p.id}/${f}`).join('\n')}\n\n# 2. run the judge (re-run as often as you like)\nnpm run project -- ${p.id}`,
        }}
      />

      <div className={`judge ${done ? 'ok' : ''}`}>
        <div className="judge-head">
          <div className="tp-label">Judge result</div>
          <button type="button" className="btn-ghost btn-xs" onClick={onRefresh}>
            <RefreshCw size={12} aria-hidden /> Refresh
          </button>
        </div>
        {!result ? (
          <p className="muted small">
            Not run yet. Run the command above while the app is open with <code className="inline-code">npm run dev</code>, and the
            result shows here within a few seconds.
          </p>
        ) : (
          <>
            <div className="judge-score">
              <span className="num">
                {result.passed}/{result.total}
              </span>
              <span className="small muted">tests passing · last run {new Date(result.ranAt).toLocaleString()}</span>
            </div>
            <ProgressBar value={pct} tone={done ? 'good' : undefined} />
            {done && (
              <p className="capstone-pass">
                <CircleCheck size={18} aria-hidden className="inline-icon" /> All tests pass. Capstone complete.
              </p>
            )}
            <ul className="test-list">
              {result.tests.map((t, i) => (
                <li key={i} className={t.ok ? 'ok' : 'bad'}>
                  <span className="mark" aria-hidden>
                    {t.ok ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                  </span>
                  <span>
                    <span className="sr-only">{t.ok ? 'Passed: ' : 'Failed: '}</span>
                    {t.name}
                    {!t.ok && t.message && <pre className="test-msg">{t.message}</pre>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </article>
  );
}
