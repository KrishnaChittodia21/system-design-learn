// node:test reporter that emits one JSON line per finished test (suites are skipped).
// Used by scripts/run-project.mjs to judge capstone projects.
export default async function* jsonReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { name, details, nesting } = event.data;
    if (details?.type === 'suite') continue;
    const err = details?.error;
    const cause = err?.cause ?? err;
    yield JSON.stringify({
      name,
      nesting,
      ok: event.type === 'test:pass',
      message: event.type === 'test:fail' ? String(cause?.message ?? err?.message ?? 'failed').split('\n').slice(0, 6).join('\n') : undefined,
    }) + '\n';
  }
}
