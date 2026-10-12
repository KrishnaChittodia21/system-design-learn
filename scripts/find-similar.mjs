// Find existing questions similar to a draft, so new questions stay unique app-wide.
// Usage:
//   node scripts/find-similar.mjs "draft question text"        # top matches for one draft
//   node scripts/find-similar.mjs --keyword "fencing token"     # every existing question mentioning a phrase
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/content/topics');

const STOP = new Set(
  'the a an and or of to in on for is are be it this that with as at by from what which when why how does do not but if then than can will would should into your you its their they was were has have had one all any each more most select apply statements statement correct true false following best'.split(
    ' ',
  ),
);
export const tokenSet = (s) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
export const jaccard = (a, b) => {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
};

export async function allQuestions() {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    let t;
    try {
      t = (await import(pathToFileURL(join(dir, f)).href)).default;
    } catch (e) {
      // a file mid-edit shouldn't break similarity checks for everyone else
      console.error(`(skipping ${f} in similarity check: ${e.message.split('\n')[0]})`);
      continue;
    }
    if (!t) continue;
    for (const q of t.test ?? []) out.push({ id: q.id, kind: 'mcq', topic: t.id, text: q.question });
    for (const q of t.interviewQuestions ?? []) out.push({ id: q.id, kind: 'iq', topic: t.id, text: q.question + ' ' + (q.context ?? '') });
    for (const q of t.envelopeQuestions ?? []) out.push({ id: q.id, kind: 'boe', topic: t.id, text: q.question });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const qs = await allQuestions();
  if (args[0] === '--keyword') {
    const kw = args.slice(1).join(' ').toLowerCase();
    const hits = qs.filter((q) => q.text.toLowerCase().includes(kw));
    for (const h of hits) console.log(`[${h.kind}] ${h.id}: ${h.text.replace(/\s+/g, ' ').slice(0, 180)}`);
    console.log(`\n${hits.length} existing questions mention "${kw}"`);
  } else {
    const draft = tokenSet(args.join(' '));
    const ranked = qs.map((q) => ({ ...q, sim: jaccard(draft, tokenSet(q.text)) })).sort((a, b) => b.sim - a.sim);
    for (const r of ranked.slice(0, 8)) console.log(`${r.sim.toFixed(2)}  [${r.kind}] ${r.id}: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}
