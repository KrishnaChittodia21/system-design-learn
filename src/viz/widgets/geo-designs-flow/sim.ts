// Pure simulations for two location designs (no React here):
//   1. Proximity search: geohash encoding (interleaved lng/lat bits, base32), the cell + 8
//      neighbours search, exact-distance filtering, the coverage limit when the radius exceeds the
//      cell size, and a density-adaptive quadtree as the alternative index.
//   2. Uber matching: driver pings into a cell index (stale drivers ignored), ring expansion around
//      the pickup cell, ranking by road ETA (Dijkstra over a street grid with a river) versus
//      straight-line distance, and offers as compare-and-set on driver state with a TTL.
import { rng, type BaseFrame } from '../../core';

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'muted' | 'mag';

// ---------------------------------------------------------------------------------------------
// geohash
// ---------------------------------------------------------------------------------------------

export const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export interface Bounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** bits of a geohash, even positions = longitude, odd = latitude, MSB first */
export function geohashBits(lat: number, lng: number, nbits: number): string {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let bits = '';
  for (let i = 0; i < nbits; i++) {
    if (i % 2 === 0) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        bits += '1';
        lngLo = mid;
      } else {
        bits += '0';
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        bits += '1';
        latLo = mid;
      } else {
        bits += '0';
        latHi = mid;
      }
    }
  }
  return bits;
}

export function encode(lat: number, lng: number, precision: number): string {
  const bits = geohashBits(lat, lng, precision * 5);
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function decodeBounds(hash: string): Bounds {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let even = true;
  for (const c of hash) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new Error(`bad geohash char ${c}`);
    for (let b = 4; b >= 0; b--) {
      const bit = (v >> b) & 1;
      if (even) {
        const mid = (lngLo + lngHi) / 2;
        if (bit) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bit) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { latMin: latLo, latMax: latHi, lngMin: lngLo, lngMax: lngHi };
}

/** the 8 neighbours, by re-encoding points one cell away from the centre (N, NE, E, SE, S, SW, W, NW) */
export function neighbours(hash: string): string[] {
  const b = decodeBounds(hash);
  const dLat = b.latMax - b.latMin;
  const dLng = b.lngMax - b.lngMin;
  const cLat = (b.latMin + b.latMax) / 2;
  const cLng = (b.lngMin + b.lngMax) / 2;
  const dirs: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  return dirs.map(([dy, dx]) => encode(cLat + dy * dLat, cLng + dx * dLng, hash.length));
}

const R_KM = 6371;
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** cell size in km at a latitude */
export function cellKm(hash: string): { w: number; h: number } {
  const b = decodeBounds(hash);
  const lat = (b.latMin + b.latMax) / 2;
  return { w: haversineKm(lat, b.lngMin, lat, b.lngMax), h: haversineKm(b.latMin, b.lngMin, b.latMax, b.lngMin) };
}

// ---------------------------------------------------------------------------------------------
// 1. Proximity search
// ---------------------------------------------------------------------------------------------

export type GeoIndex = 'geohash' | 'quadtree';

export interface ProxParams {
  index: GeoIndex;
  radiusKm: number;
}

export const PRECISION = 6;
/** a point in Bengaluru, moved close to the top edge of its precision-6 cell */
export function userPoint(): { lat: number; lng: number } {
  const b = decodeBounds(encode(12.9716, 77.5946, PRECISION));
  return { lat: b.latMax - (b.latMax - b.latMin) * 0.12, lng: b.lngMin + (b.lngMax - b.lngMin) * 0.55 };
}

export interface Biz {
  id: string;
  lat: number;
  lng: number;
  hash: string;
}

/** businesses spread over the 5 × 5 cells around the user, plus one just across the top edge */
export function businesses(): Biz[] {
  const u = userPoint();
  const ub = decodeBounds(encode(u.lat, u.lng, PRECISION));
  const dLat = ub.latMax - ub.latMin;
  const dLng = ub.lngMax - ub.lngMin;
  const r = rng(21);
  const out: Biz[] = [];
  for (let i = 0; i < 46; i++) {
    const lat = ub.latMin - 2 * dLat + r() * 5 * dLat;
    const lng = ub.lngMin - 2 * dLng + r() * 5 * dLng;
    out.push({ id: `b${i + 1}`, lat, lng, hash: encode(lat, lng, PRECISION) });
  }
  // the classic boundary case: 90 m away, but in the cell above
  const lat = ub.latMax + dLat * 0.06;
  const lng = u.lng + dLng * 0.02;
  out.push({ id: 'b0', lat, lng, hash: encode(lat, lng, PRECISION) });
  // ~0.9 km north: two cells up, outside the 9-cell box
  const fLat = ub.latMax + dLat * 1.3;
  const fLng = u.lng - dLng * 0.05;
  out.push({ id: 'b47', lat: fLat, lng: fLng, hash: encode(fLat, fLng, PRECISION) });
  return out;
}

export interface QNode {
  b: Bounds;
  depth: number;
  ids: string[];
  kids?: QNode[];
}

export const LEAF_CAP = 4;

/** split a cell into four until each leaf holds at most LEAF_CAP businesses */
export function buildQuadtree(items: Biz[], b: Bounds, depth = 0, maxDepth = 6): QNode {
  const inside = items.filter((x) => x.lat >= b.latMin && x.lat < b.latMax && x.lng >= b.lngMin && x.lng < b.lngMax);
  if (inside.length <= LEAF_CAP || depth >= maxDepth) return { b, depth, ids: inside.map((x) => x.id) };
  const mLat = (b.latMin + b.latMax) / 2;
  const mLng = (b.lngMin + b.lngMax) / 2;
  const quads: Bounds[] = [
    { latMin: mLat, latMax: b.latMax, lngMin: b.lngMin, lngMax: mLng },
    { latMin: mLat, latMax: b.latMax, lngMin: mLng, lngMax: b.lngMax },
    { latMin: b.latMin, latMax: mLat, lngMin: b.lngMin, lngMax: mLng },
    { latMin: b.latMin, latMax: mLat, lngMin: mLng, lngMax: b.lngMax },
  ];
  return { b, depth, ids: [], kids: quads.map((q) => buildQuadtree(inside, q, depth + 1, maxDepth)) };
}

export function leaves(n: QNode): QNode[] {
  return n.kids ? n.kids.flatMap(leaves) : [n];
}

/** does a leaf's rectangle come within r km of the point? (nearest point of the rectangle) */
export function rectWithin(b: Bounds, lat: number, lng: number, rKm: number): boolean {
  const cLat = Math.max(b.latMin, Math.min(lat, b.latMax));
  const cLng = Math.max(b.lngMin, Math.min(lng, b.lngMax));
  return haversineKm(lat, lng, cLat, cLng) <= rKm;
}

export interface ProxFrame extends BaseFrame {
  bits: string;
  hash: string;
  /** cells to draw: the user's cell and its neighbours, once known */
  cells: { hash: string; role: 'home' | 'neighbour' }[];
  candidates: string[];
  results: { id: string; km: number }[];
  missed: string[];
  qLeaves: Bounds[] | null;
  qHit: Bounds[];
  showRadius: boolean;
}

export function simulateProx({ index, radiusKm }: ProxParams): ProxFrame[] {
  const frames: ProxFrame[] = [];
  const u = userPoint();
  const all = businesses();
  const hash = encode(u.lat, u.lng, PRECISION);
  const fullBits = geohashBits(u.lat, u.lng, PRECISION * 5);
  const truth = all
    .map((b) => ({ id: b.id, km: haversineKm(u.lat, u.lng, b.lat, b.lng) }))
    .filter((x) => x.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
  const size = cellKm(hash);
  let bits = '';
  let cells: ProxFrame['cells'] = [];
  let candidates: string[] = [];
  let results: ProxFrame['results'] = [];
  let missed: string[] = [];
  let qLeaves: Bounds[] | null = null;
  let qHit: Bounds[] = [];
  let showRadius = false;
  const snap = (caption: string, predict?: string) =>
    frames.push({ caption, predict, bits, hash: bits.length >= 5 ? hash.slice(0, Math.floor(bits.length / 5)) : '', cells: cells.map((c) => ({ ...c })), candidates: [...candidates], results: results.map((r) => ({ ...r })), missed: [...missed], qLeaves, qHit, showRadius });

  showRadius = true;
  snap(`"Restaurants within ${radiusKm} km of me" at ${u.lat.toFixed(4)}, ${u.lng.toFixed(4)} (Bengaluru). Two separate indexes on lat and lng would each return a huge band; we need one key that keeps nearby places together.`);

  if (index === 'geohash') {
    bits = fullBits.slice(0, 2);
    snap('Geohash halves the world repeatedly. Bit 1: is the longitude in the east half (≥ 0°)? Yes → 1. Bit 2: is the latitude in the north half (≥ 0°)? Yes → 1. Even bits are longitude, odd bits latitude, interleaved.');
    bits = fullBits.slice(0, 10);
    snap(`Keep halving, alternating longitude and latitude: 10 bits = ${bits}. Every 5 bits become one base32 character: "${hash.slice(0, 2)}". Each extra character shrinks the cell about 32×.`);
    bits = fullBits;
    cells = [{ hash, role: 'home' }];
    snap(
      `30 bits → 6 characters: "${hash}", a cell about ${size.w.toFixed(2)} km × ${size.h.toFixed(2)} km. Nearby places share a prefix, so a B-tree or Redis range on the string finds them.`,
      'The closest restaurant is 90 m north of you. Is it in your cell?',
    );
    const b0 = all.find((b) => b.id === 'b0')!;
    snap(`No: b0 is just across the top edge, in cell "${b0.hash}". Two points metres apart can sit in different cells (and near the equator or prime meridian share no prefix at all). Searching only your own cell would miss it.`);
    const nb = neighbours(hash);
    cells = [{ hash, role: 'home' }, ...nb.map((h) => ({ hash: h, role: 'neighbour' as const }))];
    const set = new Set([hash, ...nb]);
    candidates = all.filter((b) => set.has(b.hash)).map((b) => b.id);
    snap(`So always query the cell plus its 8 neighbours: ${nb.join(', ')}. That is 9 prefix lookups and ${candidates.length} candidate businesses.`);
    const found = all.filter((b) => set.has(b.hash)).map((b) => ({ id: b.id, km: haversineKm(u.lat, u.lng, b.lat, b.lng) }));
    results = found.filter((x) => x.km <= radiusKm).sort((a, b) => a.km - b.km);
    missed = truth.filter((t) => !results.some((r) => r.id === t.id)).map((t) => t.id);
    snap(
      `Filter the candidates by true (haversine) distance ≤ ${radiusKm} km: ${results.length} result${results.length === 1 ? '' : 's'}, nearest ${results[0] ? `${results[0].id} at ${(results[0].km * 1000).toFixed(0)} m` : 'none'}. Cells only narrow the search; distance decides.`,
    );
    const guaranteed = Math.min(size.w, size.h);
    snap(
      missed.length
        ? `But ${missed.length} place${missed.length === 1 ? ' is' : 's are'} within ${radiusKm} km yet outside the 9 cells (${missed.join(', ')}). The 9-cell box only guarantees a radius up to the smaller cell side (${guaranteed.toFixed(2)} km). Drop one precision level (5 chars, ~4.9 km cells) and repeat.`
        : `Complete: every place within ${radiusKm} km was in the 9 cells, because the radius is under the smaller cell side (${guaranteed.toFixed(2)} km). Try a larger radius to break that guarantee.`,
    );
    return frames;
  }

  // quadtree
  const ub = decodeBounds(hash);
  const dLat = ub.latMax - ub.latMin;
  const dLng = ub.lngMax - ub.lngMin;
  const root: Bounds = { latMin: ub.latMin - 2 * dLat, latMax: ub.latMin + 3 * dLat, lngMin: ub.lngMin - 2 * dLng, lngMax: ub.lngMin + 3 * dLng };
  const tree = buildQuadtree(all, root);
  const lv = leaves(tree);
  for (let d = 0; d <= Math.max(...lv.map((l) => l.depth)); d++) {
    const cut = (n: QNode): Bounds[] => (n.depth >= d || !n.kids ? [n.b] : n.kids.flatMap(cut));
    qLeaves = cut(tree);
    if (d === 0) snap(`A quadtree starts with one cell covering the area and ${all.length} businesses, then splits any cell holding more than ${LEAF_CAP} into four quadrants.`);
    else if (d === 1) snap(`Depth ${d}: ${qLeaves.length} cells. Dense areas keep splitting; empty ones stop. The tree adapts to density, which a fixed grid cannot.`, 'Which leaves must be searched for your radius?');
  }
  qLeaves = lv.map((l) => l.b);
  snap(`Fully built: ${lv.length} leaves, none with more than ${LEAF_CAP} places. At 200M businesses this is ~1.7 GB in memory, rebuilt at server start.`);
  const hit = lv.filter((l) => rectWithin(l.b, u.lat, u.lng, radiusKm));
  qHit = hit.map((l) => l.b);
  candidates = hit.flatMap((l) => l.ids);
  snap(`Walk the tree and keep only leaves whose rectangle comes within ${radiusKm} km of you: ${hit.length} leaves, ${candidates.length} candidates. No boundary problem: every leaf touching the circle is visited.`);
  results = candidates
    .map((id) => all.find((b) => b.id === id)!)
    .map((b) => ({ id: b.id, km: haversineKm(u.lat, u.lng, b.lat, b.lng) }))
    .filter((x) => x.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
  missed = truth.filter((t) => !results.some((r) => r.id === t.id)).map((t) => t.id);
  snap(`Exact distance filter: ${results.length} result${results.length === 1 ? '' : 's'}${results[0] ? `, nearest ${results[0].id} at ${(results[0].km * 1000).toFixed(0)} m` : ''}; missed: ${missed.length}. The cost: updates need locking or rebuilds, while a geohash is just a string column.`);
  return frames;
}

// ---------------------------------------------------------------------------------------------
// 2. Uber matching
// ---------------------------------------------------------------------------------------------

export const COLS = 11;
export const ROWS = 7;
/** the river runs between column 5 and 6; only row 1 has a bridge */
export const RIVER_AFTER_COL = 5;
export const BRIDGE_ROW = 1;
export const STALE_S = 30;
export const RIDER = { x: 7, y: 4 };

export type Rank = 'distance' | 'eta';

export interface UberParams {
  rank: Rank;
  rival: boolean;
  ignore: boolean;
}

export interface Driver {
  id: string;
  x: number;
  y: number;
  state: 'IDLE' | 'ON_TRIP' | 'OFFERED';
  lastPingS: number;
}

export function initialDrivers(): Driver[] {
  return [
    { id: 'D1', x: 5, y: 4, state: 'IDLE', lastPingS: 2 },
    { id: 'D2', x: 9, y: 1, state: 'IDLE', lastPingS: 3 },
    { id: 'D3', x: 7, y: 5, state: 'IDLE', lastPingS: 41 },
    { id: 'D4', x: 8, y: 3, state: 'ON_TRIP', lastPingS: 1 },
    { id: 'D5', x: 10, y: 5, state: 'IDLE', lastPingS: 4 },
    { id: 'D6', x: 2, y: 2, state: 'IDLE', lastPingS: 2 },
  ];
}

const key = (x: number, y: number) => `${x},${y}`;

/** can you drive directly between two adjacent intersections? (the river blocks except at the bridge) */
export function edgeOpen(ax: number, ay: number, bx: number, by: number): boolean {
  if (ay === by && Math.min(ax, bx) === RIVER_AFTER_COL && Math.max(ax, bx) === RIVER_AFTER_COL + 1) return ay === BRIDGE_ROW;
  return true;
}

/** Dijkstra over the street grid, 1 minute per block. Returns minutes and the path. */
export function roadEta(from: { x: number; y: number }, to: { x: number; y: number }): { min: number; path: { x: number; y: number }[] } {
  const dist = new Map<string, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let best: string | null = null;
    for (const [k, d] of dist) if (!done.has(k) && (best === null || d < dist.get(best)!)) best = k;
    if (best === null) return { min: Infinity, path: [] };
    const [bx, by] = best.split(',').map(Number);
    if (bx === to.x && by === to.y) break;
    done.add(best);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = bx + dx;
      const ny = by + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || !edgeOpen(bx, by, nx, ny)) continue;
      const nk = key(nx, ny);
      const nd = dist.get(best)! + 1;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, best);
      }
    }
  }
  const path: { x: number; y: number }[] = [];
  let cur: string | undefined = key(to.x, to.y);
  while (cur) {
    const [x, y] = cur.split(',').map(Number);
    path.unshift({ x, y });
    cur = prev.get(cur);
  }
  return { min: dist.get(key(to.x, to.y))!, path };
}

export const straightKm = (d: { x: number; y: number }) => Math.hypot(d.x - RIDER.x, d.y - RIDER.y) * 0.5;

/** drivers within Chebyshev ring k of the rider's cell */
export function ring(drivers: Driver[], k: number): Driver[] {
  return drivers.filter((d) => Math.max(Math.abs(d.x - RIDER.x), Math.abs(d.y - RIDER.y)) <= k);
}

/** atomic compare-and-set on driver state */
export function cas(d: Driver, expect: Driver['state'], next: Driver['state']): boolean {
  if (d.state !== expect) return false;
  d.state = next;
  return true;
}

export interface Cand {
  id: string;
  km: number;
  eta: number;
  note?: string;
}

export interface UberFrame extends BaseFrame {
  drivers: Driver[];
  ringK: number;
  cands: Cand[];
  path: { x: number; y: number }[] | null;
  rivalPath: boolean;
  offered: string | null;
  assigned: string | null;
  trip: string;
}

export const MIN_CANDIDATES = 3;

export function simulateUber({ rank, rival, ignore }: UberParams): UberFrame[] {
  const frames: UberFrame[] = [];
  const drivers = initialDrivers();
  let ringK = -1;
  let cands: Cand[] = [];
  let path: UberFrame['path'] = null;
  let offered: string | null = null;
  let assigned: string | null = null;
  let trip = '—';
  let rivalPath = false;
  const snap = (caption: string, predict?: string) =>
    frames.push({ caption, predict, drivers: drivers.map((d) => ({ ...d })), ringK, cands: cands.map((c) => ({ ...c })), path, rivalPath, offered, assigned, trip });

  snap(`Six drivers are online. Each phone pings its location every ~4 s to the location service, which keeps only the latest position per driver in an in-memory index keyed by cell (H3 hexagons in production; squares here) and also publishes to Kafka for tracking, ETA models and surge.`);
  snap(`D3 last pinged ${drivers.find((d) => d.id === 'D3')!.lastPingS} s ago (> ${STALE_S} s): probably lost signal, so it is treated as gone. D4 is on a trip. Neither can be matched.`);
  trip = 'REQUESTED';
  snap(`A rider at the star requests a ride. The trip is created as REQUESTED with an idempotency key, so a double tap does not create two trips.`, 'Which drivers become candidates, and in what order?');

  const eligible = (d: Driver) => d.state === 'IDLE' && d.lastPingS <= STALE_S;
  for (let k = 0; k <= 4; k++) {
    ringK = k;
    const inRing = ring(drivers, k);
    const ok = inRing.filter(eligible);
    const skipped = inRing.filter((d) => !eligible(d)).map((d) => `${d.id} (${d.state === 'ON_TRIP' ? 'on trip' : 'stale'})`);
    cands = ok.map((d) => ({ id: d.id, km: straightKm(d), eta: roadEta(d, RIDER).min }));
    snap(`Ring ${k} around the pickup cell: ${ok.length} eligible driver${ok.length === 1 ? '' : 's'}${ok.length ? ` (${ok.map((d) => d.id).join(', ')})` : ''}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}.${ok.length >= MIN_CANDIDATES ? ` Enough candidates (≥ ${MIN_CANDIDATES}); stop expanding.` : ' Expand one more ring.'}`);
    if (ok.length >= MIN_CANDIDATES) break;
  }

  const sorted = [...cands].sort((a, b) => (rank === 'eta' ? a.eta - b.eta || a.km - b.km : a.km - b.km || a.eta - b.eta));
  cands = sorted;
  const byKm = [...cands].sort((a, b) => a.km - b.km)[0];
  const byEta = [...cands].sort((a, b) => a.eta - b.eta)[0];
  path = roadEta(drivers.find((d) => d.id === sorted[0].id)!, RIDER).path;
  snap(
    rank === 'eta'
      ? `Rank by road ETA: the routing service runs a shortest-path search for each candidate. ${byKm.id} is closest in a straight line (${byKm.km.toFixed(1)} km) but on the far side of the river: ${byKm.eta} min via the only bridge. ${byEta.id} is ${byEta.eta} min away. Best: ${sorted[0].id}.`
      : `Rank by straight-line distance: ${sorted[0].id} wins at ${sorted[0].km.toFixed(1)} km. Its actual drive is ${sorted[0].eta} min, because the river is in the way and the only bridge is up north.${byEta.id !== sorted[0].id ? ` ${byEta.id} would have arrived in ${byEta.eta} min.` : ''}`,
  );

  let idx = 0;
  if (rival) {
    const top = drivers.find((d) => d.id === sorted[0].id)!;
    cas(top, 'IDLE', 'OFFERED');
    rivalPath = true;
    snap(`Meanwhile a second rider nearby is being matched by another dispatcher, which also picked ${top.id}. Its compare-and-set IDLE → OFFERED(trip B) commits first.`);
    const mine = cas(top, 'IDLE', 'OFFERED');
    snap(`Our dispatcher runs UPDATE drivers SET state = 'OFFERED' WHERE id = '${top.id}' AND state = 'IDLE': ${mine ? '1 row' : '0 rows'}. ${top.id} is taken, so we move to the next candidate. No driver ever gets two trips.`);
    idx = 1;
  }
  for (; idx < sorted.length; idx++) {
    const d = drivers.find((x) => x.id === sorted[idx].id)!;
    if (!cas(d, 'IDLE', 'OFFERED')) continue;
    offered = d.id;
    path = roadEta(d, RIDER).path;
    trip = 'MATCHING';
    snap(`Offer to ${d.id}: compare-and-set IDLE → OFFERED(trip A) succeeds, with a 15 s TTL key. ${d.id}'s phone shows the request.`, ignore && idx === (rival ? 1 : 0) ? `${d.id}'s phone is in a pocket. What happens when nobody answers?` : undefined);
    if (ignore && idx === (rival ? 1 : 0)) {
      cas(d, 'OFFERED', 'IDLE');
      offered = null;
      snap(`15 s pass with no answer. The server-side TTL expires and releases ${d.id} (OFFERED → IDLE); without it a dead phone would hold the driver forever. Offer the next candidate.`);
      continue;
    }
    cas(d, 'OFFERED', 'ON_TRIP');
    offered = null;
    assigned = d.id;
    trip = 'DRIVER_ASSIGNED';
    snap(`${d.id} accepts: driver OFFERED → ON_TRIP and trip MATCHING → DRIVER_ASSIGNED, both conditional on the expected state. Pickup ETA ${sorted[idx].eta} min. Rider and driver now track each other through the location stream.`);
    break;
  }
  if (!assigned) snap('Every candidate was taken or ignored the offer; widen the rings and retry, escalating the radius or incentive.');
  return frames;
}
