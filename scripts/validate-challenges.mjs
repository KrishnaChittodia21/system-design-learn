// Validator for end-of-topic challenges (src/challenges/topics/<topic-id>.ts). Usage:
//   npm run validate:challenges                 # every challenge file
//   npm run validate:challenges -- id1 id2      # selected topics
// Needs Node ≥ 22.18 / 23.6 (TypeScript type stripping is on by default there; on 22.6–22.17 add
// --experimental-strip-types). Challenge files may only use `import type`, so plain node can load them.
// Errors fail the run (exit 1); warnings are printed but pass.
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/challenges/topics');
const topicDir = join(root, 'src/content/topics');
const logic = await import(pathToFileURL(join(root, 'src/challenges/logic.ts')).href);
const {
  knobValues,
  knobRefs,
  fnRefs,
  FUNCTIONS,
  searchTune,
  constraintHolds,
  constraintApplies,
  initialValues,
  interpolate,
  PLACEHOLDER,
  sequenceFits,
  flowFits,
  faultFits,
  matchFits,
  evalExpr,
  placeEdgeLabel,
  edgeKey,
  routeChoices,
  routeOnTrack,
  routeArrived,
  routeCost,
  spikeRun,
  spikeTimes,
  searchSpike,
} = logic;

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !wanted.length || wanted.includes(f.replace(/\.ts$/, '')))
  : [];
const topicIds = new Set(readdirSync(topicDir).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, '')));

const MODES = ['flow', 'sequence', 'fault', 'match', 'tune', 'route', 'spike'];
const LIMIT = {
  tab: 24,
  title: 60,
  nodeLabel: 28,
  sub: 26,
  clue: 40,
  optLabel: 28,
  ladderLabel: 34,
  edgeLabel: 14,
  matchLeft: 60,
  matchRight: 40,
  knobLabel: 24,
  gaugeLabel: 32,
  metricLabel: 22,
  packetLabel: 44,
  goalLabel: 24,
  burstLabel: 18,
  unit: 10,
};
// ---------------------------------------------------------------- board geometry
// Mirrors src/challenges/ui/Board.tsx (gridLayout) and the .cg-node styles in ui/challenge.css, checked on a
// desktop card, a tablet and a 360px phone (LAYOUTS below). Node heights are ESTIMATED from
// the text (greedy word wrap with Chrome-measured Manrope glyph widths, mono = 0.6em) and calibrated against
// the real DOM: within a few px for ~99% of nodes, so the checks keep a small margin.
/** the three boards every puzzle is checked on (board widths; fonts shrink to 12.5px below a 760px viewport) */
const LAYOUTS = [
  { name: 'desktop', where: 'desktop (1024px)', width: 900, narrow: false, small: false },
  { name: 'tablet', where: 'a tablet (≈700px, narrowest untransposed board)', width: 640, narrow: false, small: true },
  { name: 'phone', where: 'a 360px phone (transposed grid)', width: 296, narrow: true, small: true },
];
const MARGIN = 4; // px a node must keep from the board's top / bottom edge
/** printable ASCII + common symbols → advance width in em (Manrope Variable 600 / 500) */
const GLYPHS = '0123456789 !"#$%&\'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~→×≤≥–—·…’‘“”€£≈∞±½µ↔';
const em = (list) => Object.fromEntries([...GLYPHS].map((c, i) => [c, list[i] / 1000]));
const W600 = em([642,422,587,572,602,583,622,523,602,622,200,345,442,928,615,901,662,245,444,444,455,574,290,420,286,418,328,330,630,750,630,543,910,658,625,730,690,580,517,723,710,265,488,630,526,850,706,741,627,741,650,644,603,714,628,962,639,593,647,418,418,418,677,660,522,570,608,568,609,596,370,608,615,265,276,524,265,882,615,610,608,609,386,536,422,615,538,790,545,549,532,439,285,439,698,928,500,654,654,540,780,254,684,263,263,425,425,671,571,654,909,600,987,624,969]);
const W500 = em([626,406,578,563,596,581,621,513,591,621,200,329,417,924,602,901,657,229,435,435,446,575,278,420,270,403,314,318,622,750,622,534,907,646,619,723,681,575,510,714,697,249,476,612,518,845,695,732,615,732,641,630,600,708,616,949,623,575,631,413,403,413,673,660,506,563,600,561,601,591,363,600,605,249,263,510,249,865,605,601,600,601,374,531,412,605,523,779,536,538,531,429,269,429,680,925,494,649,649,540,780,240,658,243,243,398,398,660,571,649,914,600,961,614,971]);
const MONO = null; // monospace: every glyph is 0.6em
const FONT = {
  label: { table: W600, wide: 13, narrow: 12.5, lh: 1.25 }, // .cg-node (12.5px under 760px viewports)
  sub: { table: MONO, wide: 10.5, narrow: 10.5, lh: 1.3, gap: 3 }, // .cg-node small
  clue: { table: W500, wide: 11, narrow: 11, lh: 1.3, gap: 4 }, // .slot .clue
  was: { table: W600, wide: 11.5, narrow: 11.5, lh: 1.3 }, // .cg-node.exposed .cg-was
  edge: { table: MONO, wide: 11, narrow: 11, lh: 1.3 }, // .cg-edge-label
};
const textWidth = (s, f, px) => [...s].reduce((w, ch) => w + (f.table ? (f.table[ch] ?? 0.65) : 0.6) * px, 0);
/** pieces of text between line-break opportunities (spaces, hyphens, dashes, soft hyphens, zero-width spaces) */
const breakPieces = (text) => String(text).split(/(?<=[ \-–—\u00AD\u200B])/);
/** lines a text takes in a box `width` px wide (greedy wrap; an unbreakable word wider than the box overflows on its own line) */
function lineCount(text, f, px, width) {
  if (!text) return 0;
  let n = 1;
  let cur = 0;
  for (const piece of breakPieces(text)) {
    const t = piece.replace(/[\u00AD\u200B]/g, '');
    const w = textWidth(t.replace(/ $/, ''), f, px);
    if (cur > 0 && cur + w > width) {
      n++;
      cur = 0;
    }
    cur += textWidth(t, f, px);
  }
  return n;
}
/** the board layout Board.tsx uses for a board width */
function boardLayout(layout, cols, rows) {
  const { width, narrow, small } = layout;
  const gc = narrow ? rows : cols;
  const gr = narrow ? cols : rows;
  const pad = narrow ? 10 : 20;
  const height = Math.round(gr * (narrow ? 150 : 112) + 40);
  const inner = width - 2 * pad;
  const spacing = inner / Math.max(1, gc);
  const nodeW = Math.round(narrow ? Math.max(84, Math.min(128, spacing - 8)) : Math.max(92, Math.min(150, spacing - 12)));
  const pos = (n) => {
    const c = narrow ? n.row : n.col;
    const r = narrow ? n.col : n.row;
    const x = pad + (inner * (c + 0.5)) / gc;
    return { x: Math.min(Math.max(x, nodeW / 2 + 4), width - nodeW / 2 - 4), y: 20 + ((height - 40) * (r + 0.5)) / gr };
  };
  return { narrow, small, width, height, nodeW, pos };
}
/** a node's rendered box for one text state: { label, sub } or a slot { clue, was? } */
function nodeBox(state, kind, L) {
  const slot = state.slot || state.clue !== undefined;
  const bw = slot ? 2 : 1.5;
  const w = kind === 'decision' && !L.narrow ? L.nodeW - 14 : L.nodeW;
  const cw = w - 20 - 2 * bw; // padding 8px 10px
  const px = (f) => (L.small ? f.narrow : f.wide);
  const block = (text, f) => (text ? lineCount(text, f, px(f), cw) * px(f) * f.lh + (f.gap ?? 0) : 0);
  let h = 16 + 2 * bw + (kind === 'decision' ? 14.75 : 0);
  if (state.clue !== undefined) h += (state.was ? block(state.was, FONT.was) : 18) + block(state.clue, FONT.clue);
  else h += block(state.label, FONT.label) + block(state.sub, FONT.sub);
  return { w, h: Math.max(kind === 'decision' ? 64 : 58, h), cw };
}
/** words that can't break and are wider than the phone node: they overflow the box */
function longWords(text, f, L, maxW) {
  const px = L.small ? f.narrow : f.wide;
  const out = [];
  for (const piece of breakPieces(text ?? '')) {
    // a soft hyphen splits the word, so measure each part
    for (const part of piece.split(/[\u00AD\u200B]/)) {
      const word = part.trim();
      if (word && textWidth(word, f, px) > maxW) out.push(word);
    }
  }
  return out;
}

/** puzzle id → topics using it (ids only need to be unique per topic, but unique overall avoids confusion) */
const idTopics = new Map();
let failures = 0;
let warnCount = 0;
let puzzleCount = 0;
const modeCount = Object.fromEntries(MODES.map((m) => [m, 0]));

const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const kebab = (s) => typeof s === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

for (const file of files) {
  const errs = [];
  const warns = [];
  const infos = [];
  let set;
  try {
    set = (await import(pathToFileURL(join(dir, file)).href)).default;
  } catch (e) {
    console.log(`✗ ${file}: failed to import — ${e.message}`);
    failures++;
    continue;
  }
  const topic = file.replace(/\.ts$/, '');
  if (!set || typeof set !== 'object') errs.push('no default export');
  else {
    if (set.topic !== topic) errs.push(`topic "${set.topic}" does not match the file name`);
    if (!topicIds.has(topic)) errs.push(`no topic "${topic}" in src/content/topics`);
    if (!Array.isArray(set.puzzles) || !set.puzzles.length) errs.push('no puzzles');
    else if (set.puzzles.length > 6) warns.push(`${set.puzzles.length} puzzles (aim for 5, at most 6)`);
    const ids = new Set();
    for (const p of set.puzzles ?? []) {
      const at = `[${p?.id ?? '?'}]`;
      const e = (m) => errs.push(`${at} ${m}`);
      const w = (m) => warns.push(`${at} ${m}`);
      puzzleCount++;
      if (!kebab(p.id)) e('id must be kebab-case');
      if (ids.has(p.id)) e('duplicate puzzle id');
      ids.add(p.id);
      if (typeof p.id === 'string') idTopics.set(p.id, [...(idTopics.get(p.id) ?? []), topic]);
      if (!MODES.includes(p.mode)) {
        e(`unknown mode "${p.mode}"`);
        continue;
      }
      modeCount[p.mode]++;
      if (!isStr(p.title)) e('missing title');
      else if (p.title.length > LIMIT.title) e(`title longer than ${LIMIT.title}`);
      if (p.tab !== undefined && (!isStr(p.tab) || p.tab.length > LIMIT.tab)) e(`tab must be 1–${LIMIT.tab} characters`);
      if (!isStr(p.brief)) e('missing brief');
      if (!Array.isArray(p.why) || p.why.length < 2 || p.why.length > 5) e('why needs 2–5 items');
      (p.why ?? []).forEach((x, i) => !isStr(x) && e(`why[${i}] is empty`));
      const len = (s, max, what) => {
        // soft hyphens / zero-width spaces are invisible: they don't count
        const shown = typeof s === 'string' ? s.replace(/[\u00AD\u200B]/g, '') : s;
        if (typeof shown === 'string' && shown.length > max) e(`${what} "${shown}" is ${shown.length} characters (max ${max})`);
      };
      const uniqueLabels = (items, what) => {
        const seen = new Set();
        for (const x of items) {
          const k = String(x.label ?? '').trim().toLowerCase();
          if (seen.has(k)) e(`duplicate ${what} label "${x.label}"`);
          seen.add(k);
        }
      };
      const uniqueIds = (items, what) => {
        const seen = new Set();
        for (const x of items) {
          if (!isStr(x.id)) e(`${what} without id`);
          else if (seen.has(x.id)) e(`duplicate ${what} id "${x.id}"`);
          seen.add(x.id);
        }
      };
      const checkOptions = (opts) => {
        if (!Array.isArray(opts) || !opts.length) return e('no options');
        uniqueIds(opts, 'option');
        uniqueLabels(opts, 'option');
        for (const o of opts) {
          if (!isStr(o.label)) e(`option ${o.id} has no label`);
          len(o.label, LIMIT.optLabel, 'option label');
          len(o.sub, LIMIT.sub, 'option sub');
          if (!isStr(o.is)) e(`option ${o.id} has no "is" explanation`);
        }
        const decoys = opts.filter((o) => o.decoy).length;
        if (decoys < 1) e('needs at least 1 decoy option');
        if (decoys > 3) w(`${decoys} decoys (aim for 1–3)`);
      };
      /**
       * Board checks on both layouts (desktop + 360px phone, transposed). `states(n)` lists every text the node
       * can show ({ label, sub } or a slot's { clue, was? }); heights are estimated from all of them.
       * opts: labelOf (rendered label for length limits), cols / rows (default p.cols / p.rows),
       * edgeLabel (rendered wire label), badge (extra px the node needs above it, e.g. the stage number).
       */
      const checkBoard = (nodes, edges, opts = {}) => {
        const { labelOf = (n) => n.label, subOf = (n) => n.sub, states = (n) => [{ label: labelOf(n), sub: subOf(n) }], edgeLabel = (l) => l, badge = 0 } = opts;
        const cols = opts.cols ?? p.cols;
        const rows = opts.rows ?? p.rows;
        if (!(cols > 0) || !(rows > 0)) return e('cols and rows must be positive');
        if (cols > 7 || rows > 5) w(`grid ${cols}×${rows} is large (keep cols ≤ 7, rows ≤ 5)`);
        if (!Array.isArray(nodes) || !nodes.length) return e('no nodes');
        if (nodes.length > 9) w(`${nodes.length} nodes (aim for ≤ 8)`);
        uniqueIds(nodes, 'node');
        for (const n of nodes) {
          if (!(n.col >= 0 && n.col < cols)) e(`node ${n.id}: col ${n.col} must be in 0 … ${cols} (exclusive)`);
          if (!(n.row >= 0 && n.row < rows)) e(`node ${n.id}: row ${n.row} must be in 0 … ${rows} (exclusive)`);
          if (n.kind && !['box', 'decision', 'terminal'].includes(n.kind)) e(`node ${n.id}: unknown kind ${n.kind}`);
          len(labelOf(n), LIMIT.nodeLabel, 'node label');
          len(subOf(n), LIMIT.sub, 'node sub');
        }
        if (!Array.isArray(edges)) return e('edges must be an array');
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const longSeen = new Set();
        for (const layout of LAYOUTS) {
          const { narrow, where } = layout;
          const L = boardLayout(layout, cols, rows);
          // every node's tallest state, at its rendered width
          const box = new Map(
            nodes.map((n) => {
              const all = states(n).map((st) => nodeBox(st, n.kind, L));
              return [n.id, { w: all[0].w, h: Math.max(...all.map((b) => b.h)), cw: all[0].cw, pos: L.pos(n) }];
            }),
          );
          for (const n of nodes) {
            const { h, w: bw0, pos } = box.get(n.id);
            const top = pos.y - h / 2 - badge;
            const bottom = pos.y + h / 2;
            const fix = narrow ? `col (${n.col}) / cols (${cols})` : `row (${n.row}) / rows (${rows})`;
            if (top < MARGIN) e(`node ${n.id} is clipped at the top on ${where}: it is ~${Math.round(h)}px tall but its centre is ${Math.round(pos.y)}px from the edge; adjust ${fix}`);
            if (bottom > L.height - MARGIN)
              e(`node ${n.id} is clipped at the bottom on ${where}: it is ~${Math.round(h)}px tall but its centre is ${Math.round(L.height - pos.y)}px from the edge; adjust ${fix}`);
            // unbreakable words wider than the phone box overflow it
            if (narrow)
              for (const st of states(n))
                for (const [text, f] of [[st.label, FONT.label], [st.sub, FONT.sub], [st.clue, FONT.clue], [st.was, FONT.was]])
                  // a word may spill into the 10px side padding, but not across the border (2px clearance each side)
                  for (const word of longWords(text, f, L, bw0 - (st.clue !== undefined || st.slot ? 4 : 3) - 4)) {
                    if (longSeen.has(word)) continue;
                    longSeen.add(word);
                    w(`node ${n.id}: "${word}" can't break and is wider than the ${L.nodeW}px phone node; shorten it or add a soft hyphen (\\u00AD)`);
                  }
          }
          // overlaps (estimated boxes + a 4px gap)
          for (let i = 0; i < nodes.length; i++)
            for (let j = i + 1; j < nodes.length; j++) {
              const A = box.get(nodes[i].id);
              const B = box.get(nodes[j].id);
              if (Math.abs(A.pos.x - B.pos.x) < (A.w + B.w) / 2 + 4 && Math.abs(A.pos.y - B.pos.y) < (A.h + B.h) / 2 + 4 + badge)
                e(`nodes ${nodes[i].id} and ${nodes[j].id} overlap on ${where}; move them further apart`);
            }
          for (const [a, b, label] of edges) {
            const na = byId.get(a);
            const nb = byId.get(b);
            if (!na || !nb) continue;
            const A = box.get(a);
            const B = box.get(b);
            // a wire must not run through a third node (centre to centre, slightly shrunk boxes)
            for (const n of nodes) {
              if (n.id === a || n.id === b) continue;
              const C = box.get(n.id);
              const hw = C.w / 2 - 6;
              const hh = C.h / 2 - 6;
              let hit = false;
              for (let t = 0.02; t < 0.99 && !hit; t += 0.02) {
                const x = A.pos.x + (B.pos.x - A.pos.x) * t;
                const y = A.pos.y + (B.pos.y - A.pos.y) * t;
                hit = Math.abs(x - C.pos.x) < hw && Math.abs(y - C.pos.y) < hh;
              }
              if (hit) e(`wire ${a} → ${b} runs through node ${n.id} on ${where}`);
            }
            // a labelled wire needs room for its label (same clipping + placement as Board.tsx)
            const text = label ? edgeLabel(label) : '';
            if (!text) continue;
            const dx = B.pos.x - A.pos.x;
            const dy = B.pos.y - A.pos.y;
            const clipK = (S) => Math.min(dx === 0 ? Infinity : (S.w / 2 + 6) / Math.abs(dx), dy === 0 ? Infinity : (S.h / 2 + 6) / Math.abs(dy), 0.49);
            const ka = clipK(A);
            const kb = clipK(B);
            const x1 = A.pos.x + dx * ka;
            const x2 = B.pos.x - dx * kb;
            const y1 = A.pos.y + dy * ka;
            const y2 = B.pos.y - dy * kb;
            // same placement as Board.tsx (shared with it via logic.ts)
            const { box: bx } = placeEdgeLabel({ x1, y1, x2, y2 }, { ...A.pos, w: A.w, h: A.h }, { ...B.pos, w: B.w, h: B.h }, text, L.width);
            let why = '';
            if (bx.l < 2 || bx.r > L.width - 2 || bx.t < 2 || bx.b > L.height - 2) why = 'runs off the board edge';
            else
              for (const n of nodes) {
                const C = box.get(n.id);
                // 2px of slack: a label may touch a border
                if (bx.l < C.pos.x + C.w / 2 - 2 && bx.r > C.pos.x - C.w / 2 + 2 && bx.t < C.pos.y + C.h / 2 - 2 && bx.b > C.pos.y - C.h / 2 + 2) {
                  why = `covers node ${n.id}`;
                  break;
                }
              }
            if (why) w(`wire ${a} → ${b}: label "${text}" ${why} on ${where}; move the nodes apart or shorten the label`);
          }
        }
        const ids = new Set(nodes.map((n) => n.id));
        const seen = new Set();
        for (const ed of edges) {
          const [a, b, label] = ed;
          if (!ids.has(a)) e(`edge from unknown node "${a}"`);
          if (!ids.has(b)) e(`edge to unknown node "${b}"`);
          if (a === b) e(`self edge on ${a}`);
          // the same pair may appear twice only as alternatives (tune wires with a showIf)
          const k = `${a}>${b}`;
          if (seen.has(k) && !ed[3]) e(`duplicate edge ${a} → ${b}`);
          if (!ed[3]) seen.add(k);
          len(label, LIMIT.edgeLabel, 'edge label');
        }
        for (const n of nodes) if (!edges.some(([a, b]) => a === n.id || b === n.id)) w(`node ${n.id} has no wires`);
      };

      if (p.mode === 'flow') {
        checkOptions(p.options);
        const optOf = (id) => (p.options ?? []).find((o) => o.id === id);
        checkBoard(p.nodes, p.edges, {
          labelOf: (n) => n.label,
          // a slot shows its clue, then the placed card
          states: (n) => (n.answer ? [{ clue: n.hint ?? '' }, { label: optOf(n.answer)?.label, sub: optOf(n.answer)?.sub, slot: true }] : [{ label: n.label, sub: n.sub }]),
        });
        const slots = (p.nodes ?? []).filter((n) => n.answer);
        if (!slots.length) e('no slots (nodes with an answer)');
        const optIds = new Set((p.options ?? []).map((o) => o.id));
        const answers = new Map();
        for (const n of p.nodes ?? []) {
          if (n.answer) {
            if (!optIds.has(n.answer)) e(`slot ${n.id}: answer "${n.answer}" is not an option`);
            if (!isStr(n.hint)) e(`slot ${n.id} has no hint`);
            len(n.hint, LIMIT.clue, 'slot hint');
            if (answers.has(n.answer)) e(`option ${n.answer} answers two slots (${answers.get(n.answer)}, ${n.id})`);
            answers.set(n.answer, n.id);
            if (p.options?.find((o) => o.id === n.answer)?.decoy) e(`slot ${n.id}'s answer is marked decoy`);
          } else if (!isStr(n.label)) e(`node ${n.id} has neither label nor answer`);
        }
        for (const o of p.options ?? []) if (!o.decoy && !answers.has(o.id)) e(`option ${o.id} is not a decoy but answers no slot`);
        if (slots.length && !slots.every((s) => flowFits(p, s.id, s.answer))) e('engine rejects a correct slot answer');
      }

      if (p.mode === 'sequence') {
        if (!['ladder', 'stages'].includes(p.layout)) e('layout must be "ladder" or "stages"');
        const steps = p.steps ?? [];
        const decoys = p.decoys ?? [];
        if (steps.length < 3 || steps.length > 8) e('needs 3–8 steps');
        if (decoys.length < 1 || decoys.length > 3) e('needs 1–3 decoys');
        const all = [...steps, ...decoys];
        uniqueIds(all, 'step');
        uniqueLabels(all, 'step');
        const actorIds = new Set();
        if (p.layout === 'ladder') {
          if (!Array.isArray(p.actors) || p.actors.length !== 2) e('ladder needs exactly 2 actors');
          for (const a of p.actors ?? []) {
            if (!isStr(a.id) || !isStr(a.label)) e('actor needs id and label');
            actorIds.add(a.id);
          }
          if (actorIds.size !== 2) e('actor ids must differ');
        }
        for (const s of all) {
          len(s.label, p.layout === 'ladder' ? LIMIT.ladderLabel : LIMIT.optLabel, 'step label');
          len(s.sub, LIMIT.sub, 'step sub');
          if (!isStr(s.is)) e(`step ${s.id} has no "is" explanation`);
        }
        for (const s of steps) {
          len(s.clue, LIMIT.clue, 'step clue');
          if (p.layout === 'ladder') {
            if (!actorIds.has(s.from) || !actorIds.has(s.to)) e(`step ${s.id}: from/to must be actor ids`);
            else if (s.from === s.to) e(`step ${s.id}: from and to are the same actor`);
          }
        }
        if (!steps.every((s, i) => sequenceFits(p, i, s.id))) e('steps do not form a valid order');
        if (decoys.some((d) => steps.some((_, i) => sequenceFits(p, i, d.id)))) e('a decoy fits a position');
        if (!steps.some((s) => s.clue)) w('no step has a clue; clues make the positions readable');
        if (p.layout === 'stages' && steps.length) {
          // same layout as SequenceGame's Stages: a row of ≤ 5, snaking onto a second row
          const perRow = steps.length <= 5 ? steps.length : Math.ceil(steps.length / 2);
          const nRows = Math.ceil(steps.length / perRow);
          const at = (i) => {
            const r = Math.floor(i / perRow);
            const c = i % perRow;
            return { col: r % 2 === 0 ? c : perRow - 1 - c, row: nRows === 1 ? 0.15 : 0.025 + r * 1.25 };
          };
          const nodes = steps.map((st, i) => ({ id: `pos-${i}`, ...at(i), step: st }));
          checkBoard(
            nodes,
            nodes.slice(1).map((n, i) => [nodes[i].id, n.id]),
            {
              cols: perRow,
              rows: nRows === 1 ? 1.3 : 2.3,
              labelOf: (n) => n.step.label,
              states: (n) => [{ clue: n.step.clue ?? `Stage ${n.id}` }, { label: n.step.label, sub: n.step.sub, slot: true }],
              badge: 10, // the stage number sits 10px above the box
            },
          );
        }
      }

      if (p.mode === 'fault') {
        checkOptions(p.options);
        const optOf = (id) => (p.options ?? []).find((o) => o.id === id);
        checkBoard(p.nodes, p.edges, {
          // a fault shows its wrong design, then (exposed) the struck-through label + clue, then the fix
          states: (n) =>
            n.fault
              ? [{ label: n.label, sub: n.sub }, { was: n.label, clue: n.fault.clue ?? '' }, { label: optOf(n.fault.answer)?.label, sub: optOf(n.fault.answer)?.sub, slot: true }]
              : [{ label: n.label, sub: n.sub }],
        });
        const faults = (p.nodes ?? []).filter((n) => n.fault);
        if (faults.length < 1 || faults.length > 3) e('needs 1–3 fault nodes');
        const optIds = new Set((p.options ?? []).map((o) => o.id));
        const answers = new Set();
        for (const n of p.nodes ?? []) {
          if (!isStr(n.label)) e(`node ${n.id} has no label`);
          if (n.fault) {
            if (n.kind === 'terminal') e(`fault node ${n.id} cannot be a terminal`);
            if (!optIds.has(n.fault.answer)) e(`fault ${n.id}: answer "${n.fault.answer}" is not an option`);
            if (p.options?.find((o) => o.id === n.fault.answer)?.decoy) e(`fault ${n.id}: answer is marked decoy`);
            if (answers.has(n.fault.answer)) e(`option ${n.fault.answer} fixes two faults`);
            answers.add(n.fault.answer);
            if (!isStr(n.fault.why)) e(`fault ${n.id} has no why`);
            if (!isStr(n.fault.clue)) e(`fault ${n.id} has no clue`);
            len(n.fault.clue, LIMIT.clue, 'fault clue');
            if (!faultFits(p, n.id, n.fault.answer)) e(`engine rejects the fix for ${n.id}`);
          } else if (n.kind !== 'terminal' && !isStr(n.fine)) e(`node ${n.id} needs "fine" (why it is not the fault)`);
        }
        for (const o of p.options ?? []) if (!o.decoy && !answers.has(o.id)) e(`option ${o.id} is not a decoy but fixes no fault`);
        const ms = p.metrics ?? [];
        if (ms.length < 2 || ms.length > 4) e('needs 2–4 metrics');
        const faultIdSet = new Set(faults.map((n) => n.id));
        for (const m of ms) {
          if (!isStr(m.label)) e('metric without label');
          len(m.label, LIMIT.metricLabel, 'metric label');
          if (typeof m.bad !== 'number' || typeof m.good !== 'number' || m.bad === m.good) e(`metric ${m.label}: bad and good must be different numbers`);
          for (const f of m.fixedBy ?? []) if (!faultIdSet.has(f)) e(`metric ${m.label}: fixedBy "${f}" is not a fault node`);
        }
      }

      if (p.mode === 'match') {
        if (!isStr(p.leftTitle) || !isStr(p.rightTitle)) e('needs leftTitle and rightTitle');
        if (p.instruction !== undefined && (!isStr(p.instruction) || p.instruction.length > 60)) e('instruction must be 1–60 characters');
        const L = p.left ?? [];
        const R = p.right ?? [];
        if (L.length < 3 || L.length > 6) e('needs 3–6 left items');
        uniqueIds(L, 'left');
        uniqueIds(R, 'right');
        uniqueLabels(L, 'left');
        uniqueLabels(R, 'right');
        const rIds = new Set(R.map((r) => r.id));
        const used = new Set();
        for (const l of L) {
          len(l.label, LIMIT.matchLeft, 'left label');
          if (!rIds.has(l.answer)) e(`left ${l.id}: answer "${l.answer}" is not a right item`);
          if (!isStr(l.because)) e(`left ${l.id} has no "because"`);
          if (!matchFits(p, l.id, l.answer)) e(`engine rejects ${l.id} → ${l.answer}`);
          used.add(l.answer);
        }
        for (const r of R) {
          len(r.label, LIMIT.matchRight, 'right label');
          if (!isStr(r.is)) e(`right ${r.id} has no "is" explanation`);
          if (r.decoy && used.has(r.id)) e(`right ${r.id} is marked decoy but is an answer`);
          if (!r.decoy && !used.has(r.id)) e(`right ${r.id} is not an answer: mark it decoy`);
        }
        const dec = R.filter((r) => r.decoy).length;
        if (dec < 1) e('needs at least 1 decoy on the right');
        if (dec > 3) w(`${dec} decoys (aim for 1–3)`);
      }

      if (p.mode === 'tune') {
        const knobs = p.knobs ?? [];
        if (knobs.length < 1 || knobs.length > 5) e('needs 1–5 knobs');
        uniqueIds(knobs, 'knob');
        const kIds = new Set(knobs.map((k) => k.id));
        for (const k of knobs) {
          len(k.label, LIMIT.knobLabel, 'knob label');
          if (!['slider', 'stepper', 'toggle', 'choice'].includes(k.kind)) e(`knob ${k.id}: unknown kind ${k.kind}`);
          if (k.kind === 'slider' || k.kind === 'stepper') {
            if (typeof k.min !== 'number' || typeof k.max !== 'number' || !(k.max > k.min)) e(`knob ${k.id}: needs min < max`);
            if (k.step !== undefined && !(k.step > 0)) e(`knob ${k.id}: step must be > 0`);
          }
          if (k.kind === 'choice' && (!Array.isArray(k.choices) || k.choices.length < 2 || k.choices.length > 5)) e(`knob ${k.id}: choice needs 2–5 choices`);
          if (k.decimals !== undefined && !(Number.isInteger(k.decimals) && k.decimals >= 0 && k.decimals <= 6)) e(`knob ${k.id}: decimals must be 0–6`);
          const vals = knobValues(k);
          if (vals.length > 400) w(`knob ${k.id} has ${vals.length} positions; use a coarser step`);
          if (!vals.some((v) => Math.abs(v - k.initial) < 1e-9)) e(`knob ${k.id}: initial ${k.initial} is not a reachable value`);
        }
        const refCheck = (x, where) => {
          for (const id of knobRefs(x)) if (!kIds.has(id)) e(`${where}: unknown knob "${id}"`);
          for (const f of fnRefs(x)) if (!FUNCTIONS[f]) e(`${where}: unknown function "${f}" (register it in src/challenges/logic.ts)`);
        };
        const cs = p.constraints ?? [];
        if (cs.length < 2 || cs.length > 6) e('needs 2–6 constraints');
        uniqueIds(cs, 'constraint');
        uniqueLabels(cs, 'constraint');
        for (const c of cs) {
          len(c.label, LIMIT.gaugeLabel, 'gauge label');
          if (!['<', '<=', '>', '>=', '==', '!='].includes(c.op)) e(`constraint ${c.id}: bad op ${c.op}`);
          refCheck({ left: c.left, op: c.op, right: c.right }, `constraint ${c.id}`);
          if (c.applies) refCheck(c.applies, `constraint ${c.id} applies`);
          if (knobRefs({ left: c.left, op: c.op, right: c.right }).size === 0) e(`constraint ${c.id} uses no knob (it can never change)`);
          const d = c.display;
          if (d !== undefined && d !== 'number' && d !== 'yesno' && !(d && typeof d === 'object' && isStr(d.pass) && isStr(d.fail)))
            e(`constraint ${c.id}: display must be 'number', 'yesno' or { pass, fail }`);
          if (d && typeof d === 'object') {
            len(d.pass, LIMIT.gaugeLabel, 'gauge display text');
            len(d.fail, LIMIT.gaugeLabel, 'gauge display text');
          }
          for (const k of ['hint', 'fail', 'pass']) if (!isStr(c[k])) e(`constraint ${c.id} has no ${k}`);
        }
        const nodes = (p.nodes ?? []).map((n) => ({ ...n }));
        const init = initialValues(knobs);
        // texts are checked as rendered with the knob values that make them widest (each knob tried in turn)
        const base = Object.fromEntries(knobs.map((k) => [k.id, k.initial]));
        const widest = (text) => {
          if (!text) return text;
          const v = { ...base };
          for (const m of String(text).matchAll(PLACEHOLDER)) {
            const k = knobs.find((x) => x.id === m[1]);
            if (!k) continue;
            v[k.id] = knobValues(k).reduce((best, x) =>
              textWidth(interpolate(text, { ...v, [k.id]: x }, knobs), FONT.label, 13) > textWidth(interpolate(text, { ...v, [k.id]: best }, knobs), FONT.label, 13) ? x : best,
            v[k.id]);
          }
          return interpolate(text, v, knobs);
        };
        const placeholders = (text, where) => {
          for (const m of String(text ?? '').matchAll(PLACEHOLDER)) {
            const k = knobs.find((x) => x.id === m[1]);
            if (!k) e(`${where}: placeholder ${m[0]} is not a knob`);
            else if (m[2] && k.kind !== 'choice' && k.kind !== 'toggle') w(`${where}: ${m[0]} on a ${k.kind} knob just prints the number; use {${k.id}}`);
          }
        };
        checkBoard(nodes, p.edges ?? [], {
          labelOf: (n) => widest(n.label),
          subOf: (n) => widest(n.sub),
          states: (n) => [{ label: widest(n.label), sub: n.sub ? widest(n.sub) : undefined }],
          edgeLabel: (l) => widest(l),
        });
        for (const n of p.nodes ?? []) {
          if (!isStr(n.label)) e(`node ${n.id} has no label`);
          if (n.showIf) refCheck(n.showIf, `node ${n.id} showIf`);
          placeholders(n.label, `node ${n.id}`);
          placeholders(n.sub, `node ${n.id}`);
        }
        for (const ed of p.edges ?? []) {
          placeholders(ed[2], `wire ${ed[0]} → ${ed[1]}`);
          if (ed[3] !== undefined) {
            if (!ed[3] || typeof ed[3] !== 'object') e(`wire ${ed[0]} → ${ed[1]}: the 4th element must be a showIf rule`);
            else refCheck(ed[3], `wire ${ed[0]} → ${ed[1]} showIf`);
          }
        }
        // gauges over every setting: n/a that never applies, 0/1 gauges shown as numbers
        {
          const lists = knobs.map((k) => knobValues(k));
          const total = lists.reduce((n, l) => n * Math.max(1, l.length), 1);
          if (total <= 300_000) {
            const idx = lists.map(() => 0);
            const seen = cs.map(() => ({ applies: false, bool: true }));
            for (let n = 0; n < total; n++) {
              const v = {};
              knobs.forEach((k, i) => (v[k.id] = lists[i][idx[i]]));
              cs.forEach((c, i) => {
                if (!constraintApplies(c, v)) return;
                seen[i].applies = true;
                const l = evalExpr(c.left, v);
                const r = evalExpr(c.right, v);
                if (!((l === 0 || l === 1) && (r === 0 || r === 1))) seen[i].bool = false;
              });
              for (let i = idx.length - 1; i >= 0; i--) {
                idx[i]++;
                if (idx[i] < lists[i].length) break;
                idx[i] = 0;
              }
            }
            cs.forEach((c, i) => {
              if (c.applies && !seen[i].applies) e(`constraint ${c.id}: its applies rule never holds`);
              // a 0/1 gauge without a unit reads "1 = 0"; with a unit it is a count ("0 on call ≥ 1 on call") and fine
              if (seen[i].applies && seen[i].bool && (c.display ?? 'number') === 'number' && !c.unit)
                w(`constraint ${c.id} only ever compares 0 / 1 ("1 = 0"): set display: 'yesno' or { pass, fail }`);
            });
          }
        }
        if (!cs.length || !knobs.length) continue;
        if (cs.every((c) => constraintHolds(c, init))) e('the initial knob values already satisfy every constraint');
        const r = searchTune(p);
        if (r.tooBig) e('knob grid is too large to search (> 2M combinations): coarsen steps');
        else if (!r.first) e(`no knob setting satisfies every constraint (searched ${r.tried} combinations)`);
        else {
          const show = Object.entries(r.first)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          infos.push(`${at} solvable: ${r.solutions} of ${r.tried} settings pass (e.g. ${show})`);
          for (const c of cs)
            if (constraintApplies(c, r.first) && !Number.isFinite(evalExpr(c.left, r.first)) && !Number.isFinite(evalExpr(c.right, r.first)))
              w(`constraint ${c.id} is infinite on both sides at the solution`);
        }
      }

      if (p.mode === 'route') {
        // the hop number / packet badge sits 10px above the box
        checkBoard(p.nodes, p.edges ?? [], { badge: 10 });
        const nodeIds = new Set((p.nodes ?? []).map((n) => n.id));
        for (const n of p.nodes ?? []) if (!isStr(n.label)) e(`node ${n.id} has no label`);
        const edgeKeys = new Set((p.edges ?? []).map(([a, b]) => edgeKey(a, b)));
        const packets = p.packets ?? [];
        if (packets.length < 1 || packets.length > 4) e('needs 1–4 packets');
        uniqueIds(packets, 'packet');
        const fmt = (path) => path.join(' → ');
        let totalDecisions = 0;
        for (const k of packets) {
          const pk = `packet ${k.id}`;
          if (!isStr(k.label)) e(`${pk} has no label`);
          len(k.label, LIMIT.packetLabel, 'packet label');
          len(k.sub, LIMIT.packetLabel, 'packet sub');
          if (!isStr(k.done)) e(`${pk} has no "done" explanation`);
          if (!nodeIds.has(k.from)) e(`${pk}: from "${k.from}" is not a node`);
          if (k.to !== undefined && !nodeIds.has(k.to)) e(`${pk}: to "${k.to}" is not a node`);
          if (k.from === k.to) e(`${pk}: from and to are the same node`);
          if (!k.wrong || typeof k.wrong !== 'object') e(`${pk} needs a "wrong" map (edge 'a>b' → why that hop is wrong)`);
          const wrong = k.wrong ?? {};
          if (!Array.isArray(k.paths) || !k.paths.length) {
            e(`${pk} needs at least one path`);
            continue;
          }
          const seenPaths = new Set();
          let pathsOk = true;
          for (const r of k.paths) {
            if (!Array.isArray(r) || r.length < 2) {
              e(`${pk}: a path needs at least two nodes`);
              pathsOk = false;
              continue;
            }
            if (seenPaths.has(fmt(r))) e(`${pk}: duplicate path ${fmt(r)}`);
            seenPaths.add(fmt(r));
            if (r[0] !== k.from) e(`${pk}: path ${fmt(r)} must start at ${k.from}`);
            if (k.to !== undefined && r[r.length - 1] !== k.to) e(`${pk}: path ${fmt(r)} must end at ${k.to} (the packet's "to")`);
            for (const q of k.paths) if (q !== r && Array.isArray(q) && q.length > r.length && r.every((x, i) => q[i] === x)) e(`${pk}: path ${fmt(r)} is a prefix of ${fmt(q)}: the packet would stop early`);
            if (new Set(r).size !== r.length) e(`${pk}: path ${fmt(r)} visits a node twice`);
            for (let i = 1; i < r.length; i++)
              if (!edgeKeys.has(edgeKey(r[i - 1], r[i]))) {
                e(`${pk}: path ${fmt(r)} uses ${r[i - 1]} → ${r[i]}, which is not a wire`);
                pathsOk = false;
              }
            if (p.meter?.budget !== undefined && routeCost(p, r) > p.meter.budget + 1e-9)
              e(`${pk}: path ${fmt(r)} costs ${routeCost(p, r)}, over the meter budget ${p.meter.budget}`);
          }
          if (!pathsOk) continue;
          // walk every acceptable prefix: each junction's options, explanations, dead ends
          let decisions = 0;
          const usedWrong = new Set();
          const seenPrefix = new Set();
          for (const r of k.paths)
            for (let i = 1; i < r.length; i++) {
              const prefix = r.slice(0, i);
              if (seenPrefix.has(fmt(prefix))) continue;
              seenPrefix.add(fmt(prefix));
              const at = r[i - 1];
              const choices = routeChoices(p, k, prefix);
              if (!choices.length) e(`${pk}: dead end at ${at}`);
              if (choices.length > 4) e(`${pk}: ${at} has ${choices.length} outgoing wires (a junction offers 2–4)`);
              if (choices.length >= 2) decisions++;
              if (!choices.some((c) => c.ok)) e(`${pk}: no acceptable hop out of ${at}`);
              for (const c of choices) {
                if (c.ok) {
                  if (wrong[c.key] !== undefined && k.paths.every((q) => q.indexOf(at) === -1 || q[q.indexOf(at) + 1] === c.to))
                    e(`${pk}: wrong["${c.key}"] is set, but that hop is on an acceptable path`);
                  continue;
                }
                usedWrong.add(c.key);
                if (!isStr(wrong[c.key])) e(`${pk}: at ${at}, the wrong hop ${at} → ${c.to} needs an explanation: wrong['${c.key}']`);
              }
            }
          if (!decisions) e(`${pk} never reaches a junction with 2+ wires: there is nothing to decide`);
          for (const key of Object.keys(wrong)) {
            if (!edgeKeys.has(key)) e(`${pk}: wrong["${key}"] is not a wire ('from>to')`);
            else if (!usedWrong.has(key)) w(`${pk}: wrong["${key}"] is never offered at a junction this packet passes`);
          }
          for (const key of Object.keys(k.right ?? {})) if (!edgeKeys.has(key)) e(`${pk}: right["${key}"] is not a wire`);
          // the engine must accept the first path hop by hop and report arrival only at the end
          const r0 = k.paths[0];
          for (let i = 1; i < r0.length; i++) if (!routeOnTrack(k, r0.slice(0, i + 1))) e(`${pk}: engine rejects hop ${r0[i - 1]} → ${r0[i]}`);
          if (!routeArrived(k, r0)) e(`${pk}: engine does not report arrival at the end of ${fmt(r0)}`);
          if (r0.slice(1, -1).some((_, i) => routeArrived(k, r0.slice(0, i + 2)))) e(`${pk}: engine reports arrival before the end of ${fmt(r0)}`);
          totalDecisions += decisions;
        }
        if (p.meter) {
          if (!isStr(p.meter.label)) e('meter needs a label');
          len(p.meter.label, LIMIT.metricLabel, 'meter label');
          for (const [key, v] of Object.entries(p.meter.costs ?? {})) {
            if (!edgeKeys.has(key)) e(`meter cost "${key}" is not a wire ('from>to')`);
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) e(`meter cost "${key}" must be a number ≥ 0`);
          }
          if (p.meter.budget !== undefined && !(p.meter.budget > 0)) e('meter budget must be > 0');
        }
        infos.push(`${at} ${packets.length} packet(s), ${totalDecisions} junction decision(s)`);
        for (const n of p.nodes ?? [])
          if (n.id && !packets.some((k) => k.paths?.some((r) => r.includes(n.id))) && !(p.edges ?? []).some(([a, b]) => b === n.id && packets.some((k) => k.wrong?.[edgeKey(a, b)])))
            w(`node ${n.id} is never on a route nor a wrong hop`);
      }

      if (p.mode === 'spike') {
        // the utilisation / installed-card badges sit 10px above the box
        checkBoard(p.nodes, p.edges ?? [], { badge: 10 });
        const nodes = p.nodes ?? [];
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const num = (x) => typeof x === 'number' && Number.isFinite(x);
        for (const n of nodes) {
          if (!isStr(n.label)) e(`node ${n.id} has no label`);
          if (n.capacity !== undefined && !(num(n.capacity) && n.capacity > 0)) e(`node ${n.id}: capacity must be > 0`);
          for (const f of ['share', 'base', 'ms', 'timeoutMs']) if (n[f] !== undefined && !(num(n[f]) && n[f] >= 0)) e(`node ${n.id}: ${f} must be a number ≥ 0`);
          len(n.unit, LIMIT.unit, 'node unit');
          if (n.kind === 'terminal' && (n.capacity || n.ms)) w(`node ${n.id} is a terminal with capacity/ms: terminals are usually the users`);
        }
        if (!nodes.some((n) => n.capacity !== undefined)) e('no node has a capacity: nothing can saturate');
        if (!nodes.some((n) => n.share > 0)) e('no node has a share > 0: traffic touches nothing');
        if (!(num(p.duration) && p.duration > 0) || !(num(p.step) && p.step > 0)) e('duration and step must be > 0');
        else {
          const ticks = spikeTimes(p).length;
          if (ticks < 10 || ticks > 61) e(`${ticks} ticks (duration / step + 1): keep it within 10–61`);
        }
        const tr = p.traffic ?? [];
        if (!Array.isArray(tr) || tr.length < 2) e('traffic needs at least 2 [second, rps] points');
        else {
          if (tr[0][0] !== 0) e('traffic must start at second 0');
          if (tr[tr.length - 1][0] !== p.duration) e(`traffic must end at the duration (${p.duration})`);
          for (let i = 0; i < tr.length; i++) {
            const [t, r] = tr[i];
            if (!num(t) || !num(r) || r < 0) e(`traffic point ${i} must be [second, rps ≥ 0]`);
            if (i && t < tr[i - 1][0]) e('traffic points must be in time order');
          }
        }
        for (const b of p.bursts ?? []) {
          if (!byId.has(b.node)) e(`burst on unknown node "${b.node}"`);
          if (!(num(b.from) && num(b.to) && b.to > b.from && b.from >= 0 && b.to <= p.duration)) e(`burst on ${b.node}: needs 0 ≤ from < to ≤ duration`);
          else if (!spikeTimes(p).some((t) => t >= b.from - 1e-9 && t < b.to - 1e-9)) e(`burst on ${b.node} (${b.from}–${b.to} s) covers no tick: widen it or use a smaller step`);
          if (!num(b.add) || b.add <= 0) e(`burst on ${b.node}: add must be > 0`);
          len(b.label, LIMIT.burstLabel, 'burst label');
        }
        const cards = p.cards ?? [];
        if (cards.length < 3 || cards.length > 8) e('needs 3–8 cards');
        uniqueIds(cards, 'card');
        uniqueLabels(cards, 'card');
        for (const c of cards) {
          if (!isStr(c.label)) e(`card ${c.id} has no label`);
          len(c.label, LIMIT.optLabel, 'card label');
          len(c.sub, LIMIT.sub, 'card sub');
          if (!isStr(c.is)) e(`card ${c.id} has no "is" explanation`);
          if (!byId.has(c.node)) e(`card ${c.id}: node "${c.node}" is not a node`);
          if (c.cost !== undefined && !(num(c.cost) && c.cost >= 0)) e(`card ${c.id}: cost must be ≥ 0`);
          if (!Array.isArray(c.effects)) e(`card ${c.id}: effects must be an array`);
          for (const ef of c.effects ?? []) {
            if ('shed' in ef) {
              if (!(num(ef.shed) && ef.shed > 0 && ef.shed < 1)) e(`card ${c.id}: shed must be between 0 and 1 (exclusive)`);
              continue;
            }
            if (!byId.has(ef.node)) e(`card ${c.id}: effect on unknown node "${ef.node}"`);
            if (ef.load === undefined && ef.capacity === undefined && ef.ms === undefined) e(`card ${c.id}: an effect needs load, capacity, ms or shed`);
            if (ef.load !== undefined && !(num(ef.load) && ef.load >= 0)) e(`card ${c.id}: load factor must be ≥ 0`);
            if (ef.capacity !== undefined && !(num(ef.capacity) && ef.capacity > 0)) e(`card ${c.id}: capacity factor must be > 0`);
            if (ef.capacity !== undefined && byId.get(ef.node)?.capacity === undefined) e(`card ${c.id}: node ${ef.node} has no capacity to scale`);
            if (ef.ms !== undefined && !num(ef.ms)) e(`card ${c.id}: ms must be a number`);
          }
          if (!c.decoy && !(c.effects ?? []).length) e(`card ${c.id} is not a decoy but has no effect`);
        }
        const decoys = cards.filter((c) => c.decoy);
        if (decoys.length < 1 || decoys.length > 3) e('needs 1–3 decoy cards');
        if (p.maxCards !== undefined && !(Number.isInteger(p.maxCards) && p.maxCards >= 1 && p.maxCards <= cards.length)) e('maxCards must be an integer from 1 to the number of cards');
        const goals = p.goals ?? [];
        if (goals.length < 1 || goals.length > 4) e('needs 1–4 goals');
        for (const g of goals) {
          const m = String(g.metric ?? '');
          const ok = ['p99', 'errors', 'shed', 'cost'].includes(m) || (m.startsWith('util:') && byId.get(m.slice(5))?.capacity !== undefined);
          if (!ok) e(`goal "${g.label}": metric "${m}" must be p99, errors, shed, cost or util:<node with a capacity>`);
          if (!num(g.max)) e(`goal "${g.label}": max must be a number`);
          if (!isStr(g.label)) e('goal without label');
          len(g.label, LIMIT.goalLabel, 'goal label');
          if (!isStr(g.fail)) e(`goal "${g.label}" has no "fail" text`);
          if (m === 'shed' && !cards.some((c) => c.effects?.some((x) => 'shed' in x))) w(`goal "${g.label}" watches shed, but no card sheds traffic`);
          if (m === 'cost' && !cards.some((c) => c.cost)) w(`goal "${g.label}" watches cost, but no card costs anything`);
        }
        if (errs.length) continue;
        // the simulation: the empty set must break, some set must pass, decoys never help on their own
        const tSec = (t) => `${+t.toFixed(2)} s`;
        const empty = spikeRun(p, new Set());
        if (empty.pass) e('the run already passes with no cards installed');
        else if (empty.breaches[0].t === 0) w(`with no cards a goal already breaks at t = 0 (${goals[empty.breaches[0].goal].label}): start the traffic lower so the spike is visible`);
        const r = searchSpike(p);
        if (!r.passing.length) e(`no card set passes (tried ${r.tried} sets${p.maxCards ? ` of ≤ ${p.maxCards} cards` : ''})`);
        else {
          const decoyIds = new Set(decoys.map((c) => c.id));
          for (const d of decoys) if (spikeRun(p, new Set([d.id])).pass) e(`decoy ${d.id} passes on its own`);
          if (r.minimal.every((s) => s.some((id) => decoyIds.has(id)))) e('every passing card set needs a decoy: unmark it or change its effect');
          const clean = r.minimal.filter((s) => !s.some((id) => decoyIds.has(id)));
          for (const c of cards) if (!c.decoy && !clean.some((s) => s.includes(c.id))) w(`card ${c.id} is not a decoy but no minimal passing set uses it`);
          if (r.passing.length > 6) w(`${r.passing.length} card sets pass: aim for a few, so the choice matters (maxCards helps)`);
          infos.push(
            `${at} solvable: ${r.passing.length} of ${r.tried} card sets pass (minimal: ${clean.map((s) => s.join(' + ')).join(' | ') || '—'}); no cards → ${goals[empty.breaches[0]?.goal]?.label ?? '?'} breaks at ${tSec(empty.breaches[0]?.t ?? 0)}`,
          );
        }
      }
    }
    const modes = new Set((set.puzzles ?? []).map((p) => p.mode));
    if ((set.puzzles?.length ?? 0) > 1 && modes.size === 1) warns.push('all puzzles use the same mode: mix modes when you can');
  }
  if (errs.length) {
    failures++;
    console.log(`✗ ${file}`);
    errs.forEach((x) => console.log(`    - ${x}`));
  } else {
    console.log(`✓ ${file}  (${set.puzzles.map((p) => `${p.mode}:${p.id}`).join(', ')})`);
  }
  infos.forEach((x) => console.log(`    · ${x}`));
  warns.forEach((x) => console.log(`    ⚠ ${x}`));
  warnCount += warns.length;
}

for (const [id, topics] of idTopics)
  if (topics.length > 1) {
    console.log(`⚠ puzzle id "${id}" is used by ${topics.length} topics (${topics.join(', ')}): ids only need to be unique per topic, but a unique id avoids confusion`);
    warnCount++;
  }

const covered = files.length;
console.log(
  `\n${covered - failures}/${covered} challenge files valid · ${puzzleCount} puzzles (${MODES.map((m) => `${m} ${modeCount[m]}`).join(', ')}) · ${warnCount} warning(s)`,
);
if (!wanted.length) console.log(`${covered}/${topicIds.size} topics have a challenge`);
process.exit(failures ? 1 : 0);
