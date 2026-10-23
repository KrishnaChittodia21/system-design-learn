import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Halo, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { simulateUrl, type CodeGen, type Redirect, type UrlParams } from './sim';

const STATIC: [string, string][] = [
  ['client', 'api'],
  ['api', 'idgen'],
  ['api', 'db'],
  ['client', 'edge'],
  ['edge', 'redirect'],
  ['redirect', 'redis'],
  ['redirect', 'db'],
  ['edge', 'kafka'],
  ['kafka', 'ch'],
];

export default function UrlView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<UrlParams>({ gen: 'counter', redirect: '302' });
  const frames = useSimulation(simulateUrl, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const nodes: Record<string, NodeDef> = {
    client: { id: 'client', label: 'Client', sub: f.browserCached ? '301 cached' : 'browser / app', x: 8, y: 30, w: 96, h: 46 },
    api: { id: 'api', label: 'API service', sub: 'validate · rate limit', x: 156, y: 30, w: 120, h: 46 },
    idgen:
      params.gen === 'hash'
        ? { id: 'idgen', label: 'Hasher', sub: 'url → 7 chars', x: 316, y: 2, w: 144, h: 36 }
        : { id: 'idgen', label: 'ID range lease', sub: '10K ids per lease', x: 316, y: 2, w: 144, h: 36 },
    db: { id: 'db', label: 'DB', sub: 'sharded by code', x: 498, y: 30, w: 94, h: 46 },
    edge: { id: 'edge', label: 'Edge / CDN', sub: 'logs each click', x: 156, y: 112, w: 120, h: 46 },
    redirect: { id: 'redirect', label: 'Redirect svc', sub: 'hot path', x: 330, y: 112, w: 116, h: 46 },
    redis: { id: 'redis', label: 'Redis', sub: 'code → url', x: 498, y: 112, w: 94, h: 46 },
    kafka: { id: 'kafka', label: 'Kafka', sub: 'click events', x: 156, y: 192, w: 120, h: 36 },
    ch: { id: 'ch', label: 'ClickHouse', sub: 'per-minute rollups', x: 330, y: 192, w: 116, h: 36 },
  };
  const s = f.stats;
  const served = s.cacheHits + s.cacheMisses;
  const hitPct = served ? Math.round((100 * s.cacheHits) / served) : 0;
  const aria = `URL shortener step ${stepper.i + 1}. ${f.code ? `Short code ${f.code}.` : ''} ${s.clicks} clicks made, ${s.edgeHits} reached the edge, ${s.dbReads} DB reads, ${s.counted} counted by analytics.`;

  return (
    <VizFrame
      title="URL shortener: create a code, then redirect at scale"
      blurb="Choose how the short code is generated and which redirect status to return, then follow one link from creation through cold, warm and repeat clicks, a scanner, and analytics."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<CodeGen>
            label="Short code from"
            value={params.gen}
            options={[
              { value: 'counter', label: 'Counter → base62' },
              { value: 'scramble', label: 'Scrambled counter' },
              { value: 'hash', label: 'Hash + collision retry' },
            ]}
            onChange={(gen) => setParams((p) => ({ ...p, gen }))}
          />
          <Choice<Redirect>
            label="Redirect status"
            value={params.redirect}
            options={[
              { value: '301', label: '301 permanent' },
              { value: '302', label: '302 temporary' },
            ]}
            onChange={(redirect) => setParams((p) => ({ ...p, redirect }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> request in flight
          <Key tone="good" /> success / cache hit
          <Key tone="warn" /> cache miss
          <Key tone="bad" /> conflict / not found
          <Key tone="mag" /> async analytics
        </>
      }
    >
      <svg viewBox="0 0 600 352" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        <text x={8} y={20} fontSize={10} className="cdf-muted">
          create path (rare)
        </text>
        <text x={8} y={124} fontSize={10} className="cdf-muted">
          redirect path (hot)
        </text>
        {STATIC.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {Object.values(nodes).map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} dim={Object.keys(f.active).length > 0 && !f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} packet k={`${stepper.i}-${k}`} />
        ))}
        {f.code && <Pill x={56} y={92} text={`sho.rt/${f.code}`} tone="good" anchor="middle" />}

        {/* code generation panel */}
        <Panel x={8} y={234} w={340} h={114} title={f.panelTitle}>
          {f.panel.length === 0 && (
            <text x={18} y={266} fontSize={10.5} className="cdf-muted">
              no code yet
            </text>
          )}
          {f.panel.slice(-9).map((l, k) => (
            <Halo key={k} x={18} y={265 + k * 9.8} text={l.text} size={9.6} weight={l.tone ? 700 : 500} anchor="start" tone={l.tone} />
          ))}
        </Panel>

        {/* counters + cache */}
        <Panel x={356} y={234} w={236} h={114} title="Traffic so far">
          {[
            ['clicks people made', s.clicks],
            ['requests at our edge', s.edgeHits],
            ['DB reads', s.dbReads],
            ['clicks counted', s.counted],
          ].map(([label, v], k) => (
            <g key={label as string}>
              <text x={366} y={263 + k * 13} fontSize={10.5} className="cdf-muted">
                {label}
              </text>
              <text x={500} y={263 + k * 13} fontSize={11} fontWeight={800} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          <text x={366} y={263 + 4 * 13} fontSize={10.5} className="cdf-muted">
            cache hit ratio
          </text>
          <text x={500} y={263 + 4 * 13} fontSize={11} fontWeight={800} textAnchor="end">
            {served ? `${hitPct}%` : '–'}
          </text>
          <text x={512} y={263} fontSize={9.5} fontWeight={700} style={{ fill: 'var(--ink-2)' }}>
            Redis
          </text>
          {f.cache.map((c, k) => (
            <text key={c.key} x={512} y={276 + k * 12} fontSize={9.5} style={{ fill: c.neg ? 'var(--warn)' : 'var(--good)' }} fontWeight={700}>
              {c.key.slice(0, 7)}
            </text>
          ))}
          {f.cache.length === 0 && (
            <text x={512} y={276} fontSize={9.5} className="cdf-muted">
              empty
            </text>
          )}
          {s.clicks > s.counted && (
            <text x={366} y={336} fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)' }}>
              {s.clicks - s.counted} click{s.clicks - s.counted === 1 ? '' : 's'} invisible to analytics
            </text>
          )}
        </Panel>
      </svg>
    </VizFrame>
  );
}
