import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { assignWindows, WindowedAggregator, ResultTable, sum, count, max, avg } = mod;
type WindowResult<R> = import('../solution/index.ts').WindowResult<R>;

const ev = (key: string, timestamp: number, value = 1, id?: string) => ({ key, timestamp, value, ...(id ? { id } : {}) });
/** Compact view of results: "key@[start,end)=value#revision". */
const show = (rs: WindowResult<number>[]) => rs.map((r) => `${r.key}@[${r.window.start},${r.window.end})=${r.value}#${r.revision}`);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('M1: tumbling windows are aligned to epoch 0 and half-open', () => {
  const t = { kind: 'tumbling', size: 10 } as const;
  assert.deepEqual(assignWindows(0, t), [{ start: 0, end: 10 }]);
  assert.deepEqual(assignWindows(9, t), [{ start: 0, end: 10 }]);
  assert.deepEqual(assignWindows(10, t), [{ start: 10, end: 20 }]);
  assert.deepEqual(assignWindows(-1, t), [{ start: -10, end: 0 }]);
  assert.throws(() => assignWindows(1, { kind: 'tumbling', size: 0 }));
});

test('M1: sliding windows return every window containing the timestamp, ascending; gaps are allowed', () => {
  const s = { kind: 'sliding', size: 10, slide: 5 } as const;
  assert.deepEqual(assignWindows(12, s), [{ start: 5, end: 15 }, { start: 10, end: 20 }]);
  assert.deepEqual(assignWindows(10, s), [{ start: 5, end: 15 }, { start: 10, end: 20 }]);
  assert.deepEqual(assignWindows(4, s), [{ start: -5, end: 5 }, { start: 0, end: 10 }]);
  assert.equal(assignWindows(7, { kind: 'sliding', size: 60, slide: 10 }).length, 6);
  assert.deepEqual(assignWindows(7, { kind: 'sliding', size: 5, slide: 10 }), [], 'ts 7 falls in the gap between [0,5) and [10,15)');
  assert.deepEqual(assignWindows(12, { kind: 'sliding', size: 5, slide: 10 }), [{ start: 10, end: 15 }]);
});

test('M1: built-in aggregators sum, count, max and avg', () => {
  const run = <A, R>(agg: { create(): A; add(a: A, v: number): A; result(a: A): R }, xs: number[]) => agg.result(xs.reduce((a, v) => agg.add(a, v), agg.create()));
  assert.equal(run(sum, [1, 2, 3]), 6);
  assert.equal(run(count, [5, 5, 5, 5]), 4);
  assert.equal(run(max, [3, 9, 2]), 9);
  assert.equal(run(avg, [2, 4, 9]), 5);
  assert.equal(run(avg, []), 0);
});

test('M2: a tumbling window fires once the watermark passes its end, per key', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum });
  assert.deepEqual(agg.process(ev('a', 1, 5)), []);
  assert.deepEqual(agg.process(ev('b', 3, 7)), []);
  assert.deepEqual(agg.process(ev('a', 9, 1)), []);
  assert.equal(agg.watermark, 9);
  const fired = agg.process(ev('a', 10, 100));
  assert.deepEqual(show(fired), ['a@[0,10)=6#0', 'b@[0,10)=7#0']);
  assert.equal(fired[0].count, 2);
  assert.deepEqual(agg.process(ev('a', 15)), []);
});

test('M2: the watermark trails the max event time by outOfOrdernessMs and never goes backwards', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, outOfOrdernessMs: 5 });
  assert.equal(agg.watermark, -Infinity);
  agg.process(ev('a', 20));
  assert.equal(agg.watermark, 15);
  agg.process(ev('a', 17));
  assert.equal(agg.watermark, 15, 'an older event does not move the watermark back');
  agg.process(ev('a', 30));
  assert.equal(agg.watermark, 25);
});

test('M2: out-of-order events within the bound land in their event-time window', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, outOfOrdernessMs: 5 });
  const out = [
    ...agg.process(ev('k', 2, 1)),
    ...agg.process(ev('k', 12, 10)), // wm 7: [0,10) still open
    ...agg.process(ev('k', 8, 2)), // arrives late in processing time, on time in event time
    ...agg.process(ev('k', 14, 20)), // wm 9
    ...agg.process(ev('k', 16, 40)), // wm 11 → [0,10) fires
  ];
  assert.deepEqual(show(out), ['k@[0,10)=3#0']);
  assert.deepEqual(show(agg.flush()), ['k@[10,20)=70#0']);
});

test('M3: events behind the watermark are dropped by default and counted', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum });
  agg.process(ev('a', 5));
  assert.deepEqual(show(agg.process(ev('a', 25))), ['a@[0,10)=1#0']);
  assert.deepEqual(agg.process(ev('a', 7, 50)), []);
  assert.equal(agg.lateCount, 1);
  assert.deepEqual(agg.sideOutput(), [], 'drop policy does not collect');
  assert.deepEqual(show(agg.flush()), ['a@[20,30)=1#0'], 'the late value never shows up');
});

test('M3: with lateEvents: "side-output" too-late events are captured for reprocessing', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, lateEvents: 'side-output' });
  agg.process(ev('a', 5));
  agg.process(ev('a', 25));
  agg.process(ev('b', 3, 9));
  agg.process(ev('a', 19, 4)); // [10,20) end 20 ≤ wm 25 → too late
  assert.deepEqual(agg.sideOutput(), [ev('b', 3, 9), ev('a', 19, 4)]);
  assert.equal(agg.lateCount, 2);
});

test('M3: in sliding windows an event counts in every window it belongs to; partly-late events still feed the open ones', () => {
  const agg = new WindowedAggregator({ window: { kind: 'sliding', size: 10, slide: 5 }, aggregator: sum });
  const out = [...agg.process(ev('a', 7, 1)), ...agg.process(ev('a', 12, 2))];
  assert.deepEqual(show(out), ['a@[0,10)=1#0']);
  // wm = 12: [5,15) still open, [0,10) closed. ts 9 belongs to both.
  assert.deepEqual(agg.process(ev('a', 9, 100)), []);
  assert.equal(agg.lateCount, 0, 'not late: it was accepted by [5,15)');
  assert.deepEqual(show(agg.flush()), ['a@[5,15)=103#0', 'a@[10,20)=2#0']);
});

test('M4: allowed lateness re-emits an updated result with a higher revision', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, allowedLatenessMs: 10 });
  agg.process(ev('a', 1, 1));
  assert.deepEqual(show(agg.process(ev('a', 12, 5))), ['a@[0,10)=1#0']);
  assert.deepEqual(show(agg.process(ev('a', 3, 10))), ['a@[0,10)=11#1'], 'late but within lateness → immediate update');
  assert.deepEqual(show(agg.process(ev('a', 4, 100))), ['a@[0,10)=111#2']);
  assert.deepEqual(show(agg.process(ev('a', 20, 0))), ['a@[10,20)=5#0']); // wm 20 = 10 + lateness → [0,10) state purged
  assert.deepEqual(agg.process(ev('a', 5, 1000)), []);
  assert.equal(agg.lateCount, 1);
});

test('M4: window state is purged once watermark ≥ end + allowedLateness (bounded memory)', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: count, allowedLatenessMs: 15 });
  for (const k of ['a', 'b', 'c']) agg.process(ev(k, 5));
  assert.equal(agg.openWindows(), 3);
  agg.process(ev('a', 20)); // fired, kept for lateness
  assert.equal(agg.openWindows(), 4);
  agg.process(ev('a', 25)); // 0+10+15 = 25 ≤ 25 → purge the three [0,10) windows
  assert.equal(agg.openWindows(), 1);
});

test('M4: a ResultTable upsert sink makes re-emission idempotent, even with replays out of order', () => {
  const table = new ResultTable<number>();
  const r = (value: number, revision: number): WindowResult<number> => ({ key: 'a', window: { start: 0, end: 10 }, value, count: 1, revision });
  assert.equal(table.apply(r(1, 0)), true);
  assert.equal(table.apply(r(11, 1)), true);
  assert.equal(table.apply(r(1, 0)), false, 'a replay of an old revision is ignored');
  assert.equal(table.apply(r(11, 1)), false, 'a duplicate is ignored');
  assert.equal(table.get('a', 0)?.value, 11);
  table.apply({ key: 'b', window: { start: 0, end: 10 }, value: 2, count: 1, revision: 0 });
  table.apply({ key: 'a', window: { start: 10, end: 20 }, value: 3, count: 1, revision: 0 });
  assert.deepEqual(table.rows().map((x) => `${x.key}@${x.window.start}`), ['a@0', 'b@0', 'a@10']);
});

test('M5: duplicate event ids from an at-least-once source are not double counted', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, allowedLatenessMs: 20 });
  agg.process(ev('a', 1, 5, 'e1'));
  agg.process(ev('a', 2, 5, 'e1'));
  agg.process(ev('a', 3, 7, 'e2'));
  assert.deepEqual(show(agg.process(ev('a', 11, 0, 'e3'))), ['a@[0,10)=12#0']);
  assert.deepEqual(agg.process(ev('a', 3, 7, 'e2')), [], 'a redelivery after firing does not create a new revision');
  assert.equal(agg.lateCount, 0);
  assert.deepEqual(show(agg.process(ev('a', 4, 1, 'e4'))), ['a@[0,10)=13#1']);
});

test('M5: advanceWatermark fires windows for an idle source; flush fires everything at end of input', () => {
  const agg = new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, outOfOrdernessMs: 100 });
  agg.process(ev('a', 1, 1));
  agg.process(ev('b', 15, 2));
  assert.deepEqual(agg.advanceWatermark(5), []);
  assert.deepEqual(show(agg.advanceWatermark(10)), ['a@[0,10)=1#0']);
  assert.deepEqual(agg.advanceWatermark(3), [], 'a lower watermark is ignored');
  assert.equal(agg.watermark, 10);
  assert.deepEqual(show(agg.flush()), ['b@[10,20)=2#0']);
  assert.equal(agg.openWindows(), 0);
  assert.deepEqual(agg.flush(), []);
});

test('M5: one watermark jump fires windows in (end, start, key) order', () => {
  const agg = new WindowedAggregator({ window: { kind: 'sliding', size: 10, slide: 5 }, aggregator: count, outOfOrdernessMs: 50 });
  agg.process(ev('z', 0));
  agg.process(ev('a', 1));
  agg.process(ev('m', 6));
  assert.deepEqual(show(agg.process(ev('q', 100))), [
    'a@[-5,5)=1#0', 'z@[-5,5)=1#0',
    'a@[0,10)=1#0', 'm@[0,10)=1#0', 'z@[0,10)=1#0',
    'm@[5,15)=1#0',
  ]);
});

test('M5: on a shuffled stream with bounded disorder, results equal a batch computation exactly', () => {
  const r = rng(99);
  const keys = ['u1', 'u2', 'u3', 'u4'];
  // Generate in event-time order, then delay each event by up to 30ms of "arrival jitter".
  const events = Array.from({ length: 3000 }, (_, i) => ({ key: keys[Math.floor(r() * 4)], timestamp: i * 3, value: 1 + Math.floor(r() * 9) }));
  const arrival = events.map((e) => ({ e, at: e.timestamp + Math.floor(r() * 30) })).sort((x, y) => x.at - y.at || x.e.timestamp - y.e.timestamp);
  const spec = { kind: 'sliding', size: 60, slide: 20 } as const;
  const agg = new WindowedAggregator({ window: spec, aggregator: sum, outOfOrdernessMs: 30 });
  const table = new ResultTable<number>();
  for (const { e } of arrival) for (const res of agg.process(e)) table.apply(res);
  for (const res of agg.flush()) table.apply(res);
  assert.equal(agg.lateCount, 0);

  const expected = new Map<string, number>();
  for (const e of events) for (const w of assignWindows(e.timestamp, spec)) {
    const k = `${e.key}@${w.start}`;
    expected.set(k, (expected.get(k) ?? 0) + e.value);
  }
  const actual = new Map(table.rows().map((x) => [`${x.key}@${x.window.start}`, x.value]));
  assert.equal(actual.size, expected.size);
  for (const [k, v] of expected) assert.equal(actual.get(k), v, k);
  assert.ok(table.rows().every((x) => x.revision === 0), 'nothing was late, so nothing was revised');
});

test('M5: the constructor validates its options', () => {
  assert.throws(() => new WindowedAggregator({ window: { kind: 'sliding', size: 10, slide: 0 }, aggregator: sum }));
  assert.throws(() => new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum, allowedLatenessMs: -1 }));
  new WindowedAggregator({ window: { kind: 'tumbling', size: 10 }, aggregator: sum }); // valid: must not throw
});
