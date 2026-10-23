// Pure model of a 90-minute machine-coding round for the topic's URL shortener. Three ways to
// spend the same 90 minutes: the topic's vertical-slice plan, building every layer completely
// before wiring anything, and gold-plating the first feature. Each plan is a list of timed
// events; frames sample the round every 10 minutes and the last frame scores the topic's rubric.
import type { BaseFrame } from '../../core';

export type Plan = 'slice' | 'layers' | 'goldplate';
export interface Params {
  plan: Plan;
}

export const FEATURES = [
  { id: 'shorten', label: 'shorten' },
  { id: 'resolve', label: 'resolve' },
  { id: 'alias', label: 'custom alias' },
  { id: 'expiry', label: 'expiry' },
  { id: 'list', label: 'list by owner' },
] as const;
export type FeatureId = (typeof FEATURES)[number]['id'];
export type FeatureState = 'todo' | 'coded' | 'runs';

type Flag = 'runnable' | 'errors' | 'atomic' | 'hook' | 'clock' | 'demo' | 'tests' | 'godclass';

interface Event {
  at: number;
  phase?: string;
  set?: Partial<Record<FeatureId, FeatureState>>;
  flags?: Flag[];
  unflags?: Flag[];
  note?: string;
}

export interface Phase {
  from: number;
  to: number;
  label: string;
}

export interface RubricRow {
  name: string;
  score: 0 | 1 | 2;
  why: string;
}

export interface Frame extends BaseFrame {
  minute: number;
  phases: Phase[];
  features: Record<FeatureId, FeatureState>;
  runnable: boolean;
  flags: Flag[];
  rubric: RubricRow[] | null;
}

const PLANS: Record<Plan, { name: string; events: Event[] }> = {
  slice: {
    name: 'Vertical slices (the topic’s plan)',
    events: [
      { at: 0, phase: 'clarify + entities', note: 'Read twice, list must-haves, write entities and the 5 operations as comments.' },
      { at: 10, phase: 'skeleton that runs', flags: ['clock'], note: 'Folders, interfaces, empty classes, a driver calling every operation with TODOs.' },
      { at: 20, phase: 'features end-to-end', flags: ['runnable'], note: 'The skeleton runs. Now one feature at a time, re-running the driver after each.' },
      { at: 30, set: { shorten: 'runs' } },
      { at: 38, set: { resolve: 'runs' } },
      { at: 47, set: { alias: 'runs' } },
      { at: 56, set: { expiry: 'runs' } },
      { at: 64, set: { list: 'runs' } },
      { at: 65, phase: 'edges + concurrency', note: 'Every must-have works on the happy path; now validation, typed errors, the atomic op.' },
      { at: 72, flags: ['errors', 'atomic'] },
      { at: 78, flags: ['hook'] },
      { at: 80, phase: 'demo + tests', note: 'Scripted demo with failure paths and a race; a few node:test cases on the rules.' },
      { at: 88, flags: ['demo', 'tests'] },
    ],
  },
  layers: {
    name: 'All layers first, wire at the end',
    events: [
      { at: 0, phase: 'skim', note: 'Skims the statement and starts typing.' },
      { at: 5, phase: 'every entity + interface', note: 'All entities, value objects and interfaces, fully fleshed out. Nothing runs yet.' },
      { at: 35, phase: 'every service method', flags: ['clock'], set: { shorten: 'coded', resolve: 'coded', alias: 'coded', expiry: 'coded', list: 'coded' }, note: 'All five operations coded in services. Still never executed.' },
      { at: 62, phase: 'wire driver + debug', note: 'First run at minute 70: import cycles, an undefined repository, wrong expiry maths.' },
      { at: 70, flags: ['runnable'] },
      { at: 76, set: { shorten: 'runs', resolve: 'runs' } },
      { at: 84, set: { alias: 'runs' }, flags: ['hook'] },
      { at: 88, note: 'Time is up while expiry and listing are still being debugged.' },
    ],
  },
  goldplate: {
    name: 'Gold-plate the first feature',
    events: [
      { at: 0, phase: 'clarify', note: 'Clarifies requirements.' },
      { at: 10, phase: 'perfect generator framework', flags: ['hook'], note: 'A plugin registry, three generator strategies, retry policies and docs for shorten alone.' },
      { at: 40, set: { shorten: 'runs' }, flags: ['runnable'] },
      { at: 50, phase: 'rush the rest in main()', flags: ['godclass'], note: 'Behind schedule: resolve and alias crammed into main() with Maps and Date.now().' },
      { at: 62, set: { resolve: 'runs' } },
      { at: 74, set: { alias: 'runs' }, note: 'Alias uses find-then-save: no atomicity.' },
      { at: 84, set: { expiry: 'coded' } },
    ],
  },
};

export const PLAN_NAME: Record<Plan, string> = { slice: PLANS.slice.name, layers: PLANS.layers.name, goldplate: PLANS.goldplate.name };

function state(plan: Plan, minute: number) {
  const features = Object.fromEntries(FEATURES.map((f) => [f.id, 'todo'])) as Record<FeatureId, FeatureState>;
  const flags = new Set<Flag>();
  const phases: Phase[] = [];
  const notes: string[] = [];
  for (const e of PLANS[plan].events) {
    if (e.at > minute) break;
    if (e.phase) {
      if (phases.length) phases[phases.length - 1].to = e.at;
      phases.push({ from: e.at, to: 90, label: e.phase });
    }
    Object.assign(features, e.set ?? {});
    e.flags?.forEach((f) => flags.add(f));
    e.unflags?.forEach((f) => flags.delete(f));
    if (e.note) notes.push(e.note);
  }
  for (const p of phases) p.to = Math.min(p.to, minute);
  return { features, flags, phases, lastNote: notes[notes.length - 1] ?? '' };
}

export function rubric(features: Record<FeatureId, FeatureState>, flags: Set<Flag>): RubricRow[] {
  const running = FEATURES.filter((f) => features[f.id] === 'runs').length;
  const r = (name: string, score: 0 | 1 | 2, why: string): RubricRow => ({ name, score, why });
  return [
    r('Functional completeness', running === 5 ? 2 : running >= 3 ? 1 : 0, `${running}/5 must-haves work in the demo`),
    r('Runs + demo', flags.has('demo') ? 2 : flags.has('runnable') ? 1 : 0, flags.has('demo') ? 'scripted demo incl. failure paths' : flags.has('runnable') ? 'runs, but no failure-path demo' : 'never ran'),
    r('Modularity', flags.has('godclass') ? 0 : 2, flags.has('godclass') ? 'Maps and logic in main()' : 'domain / services / repos / strategies'),
    r('Extensibility', flags.has('hook') ? 2 : 1, flags.has('hook') ? 'twist absorbed by a new class' : 'no extension point shown'),
    r('Testability', flags.has('tests') ? 2 : flags.has('clock') && !flags.has('godclass') ? 1 : 0, flags.has('tests') ? 'injected clock + tests on the rules' : flags.has('clock') && !flags.has('godclass') ? 'injectable clock, no tests' : 'Date.now() and statics'),
    r('Concurrency & edges', flags.has('atomic') && flags.has('errors') ? 2 : flags.has('errors') ? 1 : 0, flags.has('atomic') ? 'atomic insertIfAbsent, typed errors' : 'races and silent failures'),
  ];
}

export function simulate(p: Params): Frame[] {
  const frames: Frame[] = [];
  for (let m = 0; m <= 90; m += 10) {
    const s = state(p.plan, m);
    const runningN = FEATURES.filter((f) => s.features[f.id] === 'runs').length;
    const last = m === 90;
    const rb = last ? rubric(s.features, s.flags) : null;
    const total = rb ? rb.reduce((a, b) => a + b.score, 0) : 0;
    const caption = last
      ? `Minute 90, pens down. ${runningN}/5 must-haves run; rubric ${total}/12. ${
          p.plan === 'slice'
            ? 'Correct running code with a demo beats a beautiful design nobody saw run.'
            : p.plan === 'layers'
              ? 'Big-bang wiring found its bugs at minute 70, too late to finish. Something should run by minute 20.'
              : 'Forty minutes on one feature left the rest rushed into main(): the viva will be about the god class, not the framework.'
        }`
      : `Minute ${m}: ${s.phases[s.phases.length - 1]?.label ?? ''}. ${s.lastNote} ${s.flags.has('runnable') ? `Runnable: yes, ${runningN}/5 features work.` : 'Runnable: not yet.'}`;
    frames.push({
      minute: m,
      phases: s.phases,
      features: s.features,
      runnable: s.flags.has('runnable'),
      flags: [...s.flags],
      rubric: rb,
      caption,
      predict: m === 50 ? 'At minute 90, how many of the five must-haves will this plan have running?' : undefined,
    });
  }
  return frames;
}
