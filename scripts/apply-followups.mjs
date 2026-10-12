// Insert interviewer follow-ups into a topic file without hand-editing it.
// Usage: node scripts/apply-followups.mjs <topic-id> <followups.json>
//   followups.json = { "<item-id>": [{ "q": "...", "a": "..." }, ...], ... }
// Items that already have followUps are skipped.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [topicId, jsonPath] = process.argv.slice(2);
if (!topicId || !jsonPath) {
  console.error('usage: node scripts/apply-followups.mjs <topic-id> <followups.json>');
  process.exit(2);
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src/content/topics', `${topicId}.ts`);
let src = readFileSync(file, 'utf8');
const patch = JSON.parse(readFileSync(jsonPath, 'utf8'));

/** index of the `}` closing the object literal that contains position `from` (string/template aware) */
function closingBrace(text, from) {
  const stack = ['code'];
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const mode = stack[stack.length - 1];
    const c = text[i];
    if (mode === 'sq' || mode === 'dq') {
      if (c === '\\') i++;
      else if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"')) stack.pop();
      continue;
    }
    if (mode === 'tpl') {
      if (c === '\\') i++;
      else if (c === '`') stack.pop();
      else if (c === '$' && text[i + 1] === '{') {
        stack.push('expr');
        i++;
      }
      continue;
    }
    // plain code, or a ${...} expression inside a template literal
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (c === "'") stack.push('sq');
    else if (c === '"') stack.push('dq');
    else if (c === '`') stack.push('tpl');
    else if (c === '{') {
      if (mode === 'expr') stack.push('expr');
      else depth++;
    } else if (c === '}') {
      if (mode === 'expr') stack.pop();
      else if (depth === 0) return i;
      else depth--;
    }
  }
  throw new Error('unbalanced object');
}

let applied = 0;
const skipped = [];
for (const [id, followUps] of Object.entries(patch)) {
  if (!Array.isArray(followUps) || !followUps.every((f) => f && typeof f.q === 'string' && typeof f.a === 'string')) {
    throw new Error(`${id}: followUps must be an array of { q, a } strings`);
  }
  const marker = new RegExp(`(^[ \\t]*)id: ['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`],`, 'm');
  const m = marker.exec(src);
  if (!m) throw new Error(`${id}: not found in ${topicId}.ts`);
  const indent = m[1];
  const end = closingBrace(src, m.index + m[0].length);
  if (/\n[ \t]*followUps:/.test(src.slice(m.index, end))) {
    skipped.push(id);
    continue;
  }
  const json = JSON.stringify(followUps, null, 2).replace(/\n/g, `\n${indent}`);
  // make sure the property before the insertion ends with a comma
  let k = end - 1;
  while (/\s/.test(src[k])) k--;
  const needsComma = src[k] !== ',' && src[k] !== '{';
  const closeIndent = indent.length >= 2 ? indent.slice(0, -2) : '';
  src = `${src.slice(0, k + 1)}${needsComma ? ',' : ''}\n${indent}followUps: ${json},\n${closeIndent}${src.slice(end)}`;
  applied++;
}
writeFileSync(file, src);
console.log(`${topicId}: inserted followUps into ${applied} item(s)${skipped.length ? `; skipped (already present): ${skipped.join(', ')}` : ''}`);
