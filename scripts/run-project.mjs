// Judge a capstone project by running its test suite.
// Usage:
//   npm run project -- <project-id>             # test YOUR implementation (projects/<id>/src)
//   npm run project -- <project-id> --solution  # test the reference solution (checks the tests themselves)
//   npm run project -- --all [--solution]       # every project
//   npm run project -- --list
//   add --no-save to test without updating public/project-results.json
// Results for your own code are saved to public/project-results.json, which the app's Capstone tab reads.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectsDir = join(root, 'projects');
const resultsFile = join(root, 'public', 'project-results.json');
const args = process.argv.slice(2);
const solution = args.includes('--solution');
const save = !solution && !args.includes('--no-save');
const all = args.includes('--all');
const ids = existsSync(projectsDir)
  ? readdirSync(projectsDir).filter((d) => existsSync(join(projectsDir, d, 'project.json'))).sort()
  : [];

if (args.includes('--list') || (!all && !args.find((a) => !a.startsWith('--')))) {
  console.log('Capstone projects:');
  for (const id of ids) {
    const p = JSON.parse(readFileSync(join(projectsDir, id, 'project.json'), 'utf8'));
    console.log(`  ${id.padEnd(26)} ${p.title}`);
  }
  console.log('\nRun: npm run project -- <project-id>');
  process.exit(0);
}

const targets = all ? ids : args.filter((a) => !a.startsWith('--'));
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8') || '{}') : {};
let anyFailed = false;

for (const id of targets) {
  const dir = join(projectsDir, id);
  if (!ids.includes(id)) {
    console.error(`✗ unknown project "${id}". Try: npm run project -- --list`);
    anyFailed = true;
    continue;
  }
  const impl = join(dir, solution ? 'solution' : 'src', 'index.ts');
  const testDir = join(dir, 'test');
  const files = readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).map((f) => join(testDir, f));
  const run = spawnSync(
    process.execPath,
    ['--no-warnings', '--test', '--test-concurrency=1', '--test-reporter', join(root, 'scripts', 'test-json-reporter.mjs'), ...files],
    { cwd: dir, env: { ...process.env, PROJECT_IMPL: impl }, encoding: 'utf8', timeout: 180_000 },
  );
  const tests = (run.stdout ?? '')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l));
  const passed = tests.filter((t) => t.ok).length;
  const total = tests.length;
  const label = solution ? 'reference solution' : 'your implementation';
  if (!total) {
    console.log(`✗ ${id}: no tests ran (${label}).\n${(run.stderr ?? '').split('\n').slice(0, 15).join('\n')}`);
    anyFailed = true;
  } else {
    console.log(`\n${passed === total ? '✓' : '✗'} ${id} — ${passed}/${total} tests passed (${label})`);
    for (const t of tests) {
      console.log(`  ${t.ok ? '✓' : '✗'} ${t.name}`);
      if (!t.ok && t.message) console.log('      ' + t.message.split('\n').join('\n      '));
    }
    if (passed !== total) anyFailed = true;
  }
  if (save) {
    results[id] = { passed, failed: total - passed, total, ranAt: new Date().toISOString(), tests };
  }
}

if (save) {
  writeFileSync(resultsFile, JSON.stringify(results, null, 2) + '\n');
  console.log('\nResults saved; open the topic’s Capstone tab in the app to see them.');
}
process.exit(anyFailed ? 1 : 0);
