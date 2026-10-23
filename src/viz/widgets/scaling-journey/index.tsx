import { VizFrame, Slider, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { STAGES, frameOfStage, simulate, usersLabel, type CompId } from './sim';
import './scaling-journey.css';

const W = 100;
const H = 44;
const POS: Record<CompId, [number, number]> = {
  users: [6, 136],
  cdn: [122, 30],
  lb: [122, 136],
  app: [240, 129],
  workers: [240, 268],
  cache: [362, 30],
  db: [362, 136],
  queue: [362, 268],
  objstore: [486, 30],
  replica: [486, 136],
  search: [486, 214],
  region2: [486, 330],
};
const NO_PARAMS = {};

function anchor(a: CompId, b: CompId): [number, number, number, number] {
  const [ax, ay] = POS[a];
  const [bx, by] = POS[b];
  const ah = a === 'app' ? 58 : H;
  const bh = b === 'app' ? 58 : H;
  if (bx >= ax + W) return [ax + W, ay + ah / 2, bx, by + bh / 2];
  if (bx + W <= ax) return [ax, ay + ah / 2, bx + W, by + bh / 2];
  return by > ay ? [ax + W / 2, ay + ah, bx + W / 2, by] : [ax + W / 2, ay, bx + W / 2, by + bh];
}

export default function ScalingJourneyViz() {
  const frames = useSimulation(simulate, NO_PARAMS);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const st = STAGES[f.stage];
  const has = (c: CompId) => f.present.includes(c);
  const isNew = (c: CompId) => f.added.includes(c);
  const hot = f.phase === 'pain' ? st.hot : undefined;
  const showStage = f.phase === 'pain' ? f.stage - 1 : f.stage;
  const multiAz = showStage >= 10;

  const label: Partial<Record<CompId, string[]>> = {
    users: ['Users', 'browser / app'],
    cdn: ['CDN', 'edge PoPs'],
    lb: ['Load balancer', 'health checks'],
    workers: ['Workers', 'email · SMS · invoices'],
    cache: ['Redis', 'cache-aside'],
    queue: ['Queue', 'outbox → jobs'],
    objstore: ['Object storage', 'images, assets'],
    replica: ['Read replica', 'async'],
    search: ['Search', 'OpenSearch'],
    region2: ['Region 2', 'warm standby'],
  };
  const appLabel =
    showStage === 0 ? ['One VM', 'Nest + Postgres', '+ files'] : showStage === 1 ? ['App VM', 'NestJS'] : showStage === 2 ? ['Bigger VM', 'cluster: 1 proc/core'] : ['App pods', 'stateless', 'autoscaled'];
  const dbLabel = [
    'Postgres',
    showStage >= 9 ? 'partitioned' : showStage >= 2 ? 'scaled up' : 'managed',
    ...(multiAz ? ['+ AZ-b standby'] : []),
  ];

  const edges: [CompId, CompId, boolean?][] = [];
  if (has('cdn')) edges.push(['users', 'cdn']);
  edges.push(['users', has('lb') ? 'lb' : 'app']);
  if (has('lb')) edges.push(['lb', 'app']);
  if (has('db')) edges.push(['app', 'db']);
  if (has('cache')) edges.push(['app', 'cache']);
  if (has('replica')) edges.push(['db', 'replica', true]);
  if (has('queue')) edges.push(['app', 'queue'], ['queue', 'workers']);
  if (has('search')) edges.push(['db', 'search', true]);
  if (has('region2')) edges.push(['db', 'region2', true]);

  const box = (c: CompId, lines: string[], h = H) => {
    const [x, y] = POS[c];
    const n = isNew(c) || (c === 'app' && f.phase === 'fix' && [2, 3].includes(f.stage)) || (c === 'db' && f.phase === 'fix' && [9, 10].includes(f.stage));
    const hotHere = hot === c;
    const pods = c === 'app' && showStage >= 3;
    return (
      <g key={c}>
        {pods &&
          [2, 1].map((k) => (
            <rect key={k} x={x + k * 5} y={y - k * 5} width={W} height={h} rx={9} fill="var(--surface)" stroke="var(--line-2)" />
          ))}
        <rect
          x={x}
          y={y}
          width={W}
          height={h}
          rx={9}
          fill={hotHere ? 'var(--bad-soft)' : n ? 'var(--accent-soft)' : 'var(--surface)'}
          stroke={hotHere ? 'var(--bad)' : n ? 'var(--accent)' : 'var(--line-2)'}
          strokeWidth={hotHere || n ? 2.4 : 1.4}
          style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
        />
        {lines.map((t, i) => (
          <text key={i} x={x + W / 2} y={y + 18 + i * 14} textAnchor="middle" className={i ? 'viz-label' : undefined} style={{ fontSize: i ? 10.5 : 12.5, fontWeight: i ? 400 : 700 }}>
            {t}
          </text>
        ))}
        {n && (
          <text x={x + W - 4} y={y - 5} textAnchor="end" style={{ fontSize: 10, fontWeight: 800, fill: 'var(--accent)' }}>
            {isNew(c) ? 'NEW' : 'CHANGED'}
          </text>
        )}
        {hotHere && (
          <text x={x + W / 2} y={y + h + 14} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 800, fill: 'var(--bad)' }}>
            ▲ {st.hotLabel}
          </text>
        )}
      </g>
    );
  };

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Slider
          label="Traffic stage"
          value={f.stage}
          min={0}
          max={STAGES.length - 1}
          onChange={(v) => stepper.seek(frameOfStage(v))}
          format={(v) => `${v} · ${usersLabel(STAGES[v])}`}
        />
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> measured bottleneck (the trigger)
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> added or changed in response
          <span>dashed = async replication / feed</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 384"
        className="viz-svg"
        role="img"
        aria-label={`Stage ${f.stage}, ${f.phase === 'pain' ? 'before the change' : 'after the change'}: components ${f.present.join(', ')}.${hot ? ` Bottleneck: ${hot}.` : ''}`}
      >
        <defs>
          <marker id="sj-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-4)" />
          </marker>
        </defs>
        {multiAz && (
          <g>
            <rect x={114} y={8} width={484} height={312} rx={14} fill="none" stroke={f.stage === 10 && f.phase === 'fix' ? 'var(--accent)' : 'var(--line-2)'} strokeDasharray="6 4" strokeWidth={1.5} />
            <text x={228} y={24} style={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--accent)' }}>
              every tier × 2 AZs · N+1 pods per AZ
            </text>
          </g>
        )}
        {!multiAz && hot === undefined && f.phase === 'pain' && f.stage === 10 && (
          <g>
            <rect x={114} y={8} width={484} height={312} rx={14} fill="var(--bad-soft)" stroke="var(--bad)" strokeDasharray="6 4" />
            <text x={228} y={24} style={{ fontSize: 10.5, fontWeight: 800, fill: 'var(--bad)' }}>
              ▲ everything lives in one AZ
            </text>
          </g>
        )}
        {f.phase === 'pain' && f.stage === 11 && (
          <text x={128} y={348} style={{ fontSize: 10.5, fontWeight: 800, fill: 'var(--bad)' }}>
            ▲ one region: a regional outage is a full outage
          </text>
        )}
        {has('cdn') && has('objstore') && (
          <path d={`M${POS.cdn[0] + W / 2},${POS.cdn[1]} C${POS.cdn[0] + W / 2},-6 ${POS.objstore[0] + W / 2},-6 ${POS.objstore[0] + W / 2},${POS.objstore[1]}`} fill="none" stroke="var(--ink-4)" strokeWidth={1.4} markerEnd="url(#sj-arrow)" />
        )}
        {edges.map(([a, b, dashed]) => {
          const [x1, y1, x2, y2] = anchor(a, b);
          return <line key={a + b} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-4)" strokeWidth={1.4} strokeDasharray={dashed ? '5 4' : undefined} markerEnd="url(#sj-arrow)" />;
        })}
        {f.present.map((c) => (c === 'app' ? box('app', appLabel, 58) : c === 'db' ? box('db', dbLabel, multiAz ? 58 : H) : box(c, label[c] ?? [c])))}
      </svg>
      <dl className="sj-panel">
        <div className="sj-row">
          <dt>Stage {st.n}</dt>
          <dd>
            <strong>{st.title}</strong> · {usersLabel(st)}
          </dd>
        </div>
        <div className="sj-row is-bad">
          <dt>Trigger</dt>
          <dd>{st.trigger}</dd>
        </div>
        <div className={`sj-row ${f.phase === 'fix' ? 'is-fix' : 'is-pending'}`}>
          <dt>Change</dt>
          <dd>{f.phase === 'fix' ? st.change : 'Step forward to see the change.'}</dd>
        </div>
        <div className={`sj-row ${f.phase === 'fix' ? 'is-warn' : 'is-pending'}`}>
          <dt>New failure mode</dt>
          <dd>{f.phase === 'fix' ? st.newRisk : '…'}</dd>
        </div>
      </dl>
    </VizFrame>
  );
}
