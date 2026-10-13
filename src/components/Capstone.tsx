import { useCallback, useEffect, useState } from 'react';
import type { CapstoneProject } from '../types';
import { Badge, CodeBlock, DifficultyBadge, Markdown, ProgressBar } from './ui';

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
    <div>
      <div className="card info">
        <strong>Build it, then get it judged.</strong> Each capstone is a real project in this repo. Write your implementation in
        your editor and run its test suite. The tests are the judge, and the results appear here automatically. Read the tests
        if you are stuck, but don&apos;t change them. A reference solution is in <code className="inline-code">solution/</code>{' '}
        for after you&apos;ve tried.
      </div>
      {projects.map((p) => (
        <ProjectCard key={p.id} p={p} result={results[p.id]} onRefresh={reload} />
      ))}
    </div>
  );
}

function ProjectCard({ p, result, onRefresh }: { p: CapstoneProject; result?: ProjectResult; onRefresh: () => void }) {
  const pct = result && result.total ? Math.round((result.passed / result.total) * 100) : 0;
  const done = !!result && result.total > 0 && result.passed === result.total;
  return (
    <article className={`card capstone ${done ? 'capstone-done' : ''}`}>
      <div className="section-head">
        <h2>🔨 {p.title}</h2>
        <span className="row gap-s">
          <DifficultyBadge d={p.difficulty} />
          <Badge>~{p.estimatedHours} h</Badge>
        </span>
      </div>
      <Markdown>{p.summary}</Markdown>

      <div className="label">Milestones the tests check</div>
      <ol className="milestones">
        {p.milestones.map((m) => (
          <li key={m.name}>
            <strong>{m.name}</strong>
            <Markdown>{m.description}</Markdown>
          </li>
        ))}
      </ol>

      <div className="label">How to build and get judged</div>
      <CodeBlock
        snippet={{
          language: 'bash',
          title: 'from the repository root',
          code: `# 1. implement your solution in:\n${p.files.map((f) => `#    projects/${p.id}/${f}`).join('\n')}\n\n# 2. run the judge (re-run as often as you like)\nnpm run project -- ${p.id}`,
        }}
      />

      <div className="judge">
        <div className="row between wrap">
          <div className="label">Judge result</div>
          <button type="button" className="btn-ghost btn-xs" onClick={onRefresh}>
            Refresh
          </button>
        </div>
        {!result ? (
          <p className="muted small">
            Not run yet. Run the command above while the app is open with <code className="inline-code">npm run dev</code>, and the
            result shows here within a few seconds.
          </p>
        ) : (
          <>
            <div className="topic-progress">
              <ProgressBar value={pct} tone={done ? 'good' : undefined} />
              <span className="small">
                <strong>
                  {result.passed}/{result.total}
                </strong>{' '}
                tests passing · last run {new Date(result.ranAt).toLocaleString()}
              </span>
            </div>
            {done && <p className="capstone-pass">✅ All tests pass. Capstone complete.</p>}
            <ul className="test-list">
              {result.tests.map((t, i) => (
                <li key={i} className={t.ok ? 'ok' : 'bad'}>
                  <span className="mark">{t.ok ? '✓' : '✗'}</span>
                  <span>
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
