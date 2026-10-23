import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Halo, Key, Panel } from './kit';
import { PRECISION, businesses, decodeBounds, encode, simulateProx, userPoint, type Bounds, type GeoIndex, type ProxParams } from './sim';

const MAP = { x: 10, y: 8, w: 580, h: 290 };

export default function ProxView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<ProxParams>({ index: 'geohash', radiusKm: 0.5 });
  const frames = useSimulation(simulateProx, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const u = userPoint();
  const all = businesses();
  const home = decodeBounds(encode(u.lat, u.lng, PRECISION));
  const dLat = home.latMax - home.latMin;
  const dLng = home.lngMax - home.lngMin;
  const view: Bounds = { latMin: home.latMin - 2 * dLat, latMax: home.latMin + 3 * dLat, lngMin: home.lngMin - 2 * dLng, lngMax: home.lngMin + 3 * dLng };
  const px = (lng: number) => MAP.x + ((lng - view.lngMin) / (view.lngMax - view.lngMin)) * MAP.w;
  const py = (lat: number) => MAP.y + ((view.latMax - lat) / (view.latMax - view.latMin)) * MAP.h;
  const rect = (b: Bounds) => ({ x: px(b.lngMin), y: py(b.latMax), w: px(b.lngMax) - px(b.lngMin), h: py(b.latMin) - py(b.latMax) });
  // km → px (local equirectangular)
  const kmPerDegLat = 111.2;
  const kmPerDegLng = 111.2 * Math.cos((u.lat * Math.PI) / 180);
  const rx = (params.radiusKm / kmPerDegLng / (view.lngMax - view.lngMin)) * MAP.w;
  const ry = (params.radiusKm / kmPerDegLat / (view.latMax - view.latMin)) * MAP.h;
  const resultIds = new Set(f.results.map((r) => r.id));
  const candIds = new Set(f.candidates);
  const missedIds = new Set(f.missed);
  const aria = `Proximity search step ${stepper.i + 1}: ${f.hash ? `geohash ${f.hash}, ` : ''}${f.candidates.length} candidates, ${f.results.length} results within ${params.radiusKm} km, ${f.missed.length} missed.`;

  return (
    <VizFrame
      title="Proximity search: geohash cells vs a quadtree"
      blurb="Find places near a point in Bengaluru. Watch the geohash build up bit by bit, search the cell and its 8 neighbours, then raise the radius past the cell size, or switch to a quadtree that splits by density."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<GeoIndex>
            label="Index"
            value={params.index}
            options={[
              { value: 'geohash', label: 'Geohash (6 chars)' },
              { value: 'quadtree', label: 'Quadtree (≤ 4 per leaf)' },
            ]}
            onChange={(index) => setParams((p) => ({ ...p, index }))}
          />
          <Choice<'0.3' | '0.5' | '1'>
            label="Radius"
            value={String(params.radiusKm) as '0.3' | '0.5' | '1'}
            options={[
              { value: '0.3', label: '300 m' },
              { value: '0.5', label: '500 m' },
              { value: '1', label: '1 km' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, radiusKm: Number(v) }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> your cell / candidate
          <Key tone="good" /> neighbour cell / result
          <Key tone="bad" ring /> within radius but missed
          <Key tone="muted" /> other place
        </>
      }
    >
      <svg viewBox="0 0 600 368" className="viz-svg" role="img" aria-label={aria}>
        <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx={8} fill="var(--surface)" stroke="var(--line-2)" />
        {/* precision-6 grid */}
        {Array.from({ length: 6 }, (_, k) => (
          <g key={k}>
            <line x1={MAP.x + (k * MAP.w) / 5} x2={MAP.x + (k * MAP.w) / 5} y1={MAP.y} y2={MAP.y + MAP.h} stroke="var(--line)" />
            <line x1={MAP.x} x2={MAP.x + MAP.w} y1={MAP.y + (k * MAP.h) / 5} y2={MAP.y + (k * MAP.h) / 5} stroke="var(--line)" />
          </g>
        ))}
        {f.cells.map((c) => {
          const r = rect(decodeBounds(c.hash));
          const isHome = c.role === 'home';
          return (
            <g key={c.hash} className="gdf-pop">
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={isHome ? 'var(--blue-s)' : 'var(--good-soft)'} stroke={isHome ? 'var(--blue)' : 'var(--good)'} strokeWidth={isHome ? 2.2 : 1.2} />
              <text x={r.x + 5} y={r.y + 13} fontSize={10} fontFamily="var(--f-mono)" fontWeight={700} style={{ fill: isHome ? 'var(--blue)' : 'var(--good)' }}>
                {c.hash}
              </text>
            </g>
          );
        })}
        {f.qLeaves?.map((b, k) => {
          const r = rect(b);
          const hit = f.qHit.some((h) => h.latMin === b.latMin && h.lngMin === b.lngMin && h.latMax === b.latMax && h.lngMax === b.lngMax);
          return <rect key={k} x={r.x} y={r.y} width={r.w} height={r.h} fill={hit ? 'var(--blue-s)' : 'none'} stroke="var(--mag)" strokeWidth={1} opacity={0.9} />;
        })}
        {all.map((b) => {
          const res = resultIds.has(b.id);
          const cand = candIds.has(b.id);
          const miss = missedIds.has(b.id);
          return (
            <g key={b.id}>
              <circle cx={px(b.lng)} cy={py(b.lat)} r={res ? 5.5 : 4} fill={res ? 'var(--good)' : cand ? 'var(--blue)' : 'var(--ink-4)'} stroke={miss ? 'var(--bad)' : 'none'} strokeWidth={2.5} />
              {(res || miss || b.id === 'b0') && (
                <text x={px(b.lng) + 7} y={py(b.lat) - 5} fontSize={9.5} fontWeight={700}>
                  {b.id}
                </text>
              )}
            </g>
          );
        })}
        {f.showRadius && <ellipse cx={px(u.lng)} cy={py(u.lat)} rx={rx} ry={ry} fill="none" stroke="var(--warn)" strokeWidth={2} strokeDasharray="5 4" />}
        <path d={`M${px(u.lng)},${py(u.lat) - 9} l2.6,6 6.4,0.4 -5,4 1.7,6.3 -5.7,-3.5 -5.7,3.5 1.7,-6.3 -5,-4 6.4,-0.4z`} fill="var(--warn)" stroke="var(--ink)" strokeWidth={1} />

        {/* bits */}
        <Panel x={10} y={306} w={580} h={58} title={params.index === 'geohash' ? 'Geohash bits (lng bit, lat bit, …) → base32' : 'Quadtree leaves (magenta), searched leaves (filled)'}>
          {params.index === 'geohash' &&
            f.bits.split('').map((bit, k) => (
              <text key={k} x={22 + k * 15 + Math.floor(k / 5) * 6} y={340} fontSize={12} fontFamily="var(--f-mono)" fontWeight={700} style={{ fill: k % 2 === 0 ? 'var(--blue)' : 'var(--mag)' }}>
                {bit}
              </text>
            ))}
          {params.index === 'geohash' &&
            f.hash.split('').map((ch, k) => (
              <text key={k} x={22 + k * 81 + 30} y={357} fontSize={11} fontFamily="var(--f-mono)" fontWeight={800} textAnchor="middle">
                {ch}
              </text>
            ))}
          {params.index === 'quadtree' && <Halo x={22} y={344} anchor="start" text={`${f.qLeaves ? f.qLeaves.length : 0} cells · ${f.candidates.length} candidates · ${f.results.length} results`} size={11} />}
        </Panel>
      </svg>
    </VizFrame>
  );
}
