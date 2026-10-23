import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { CELEB_THRESHOLD, FOLLOWERS, ORIGINAL_KB, RENDITIONS, simulateInsta, type Author, type InstaParams, type Moderation } from './sim';
import type { Tone } from './sim';

const NODES: NodeDef[] = [
  { id: 'app', label: 'Author app', sub: 'phone', x: 4, y: 10, w: 104, h: 42 },
  { id: 'api', label: 'Upload / API', sub: 'sign · record', x: 120, y: 10, w: 104, h: 42 },
  { id: 'posts', label: 'Post service', sub: 'sharded PG', x: 236, y: 10, w: 104, h: 42 },
  { id: 'kafka', label: 'Kafka', sub: 'PostPublished', x: 352, y: 10, w: 104, h: 42 },
  { id: 'fanout', label: 'Fan-out', sub: 'push < 1M followers', x: 468, y: 10, w: 128, h: 42 },
  { id: 'store', label: 'Object store', sub: 'raw upload', x: 120, y: 86, w: 104, h: 42 },
  { id: 'queue', label: 'Job queue', sub: 'key = mediaId', x: 236, y: 86, w: 104, h: 42 },
  { id: 'worker', label: 'Media workers', sub: 'EXIF · resize · hash', x: 352, y: 86, w: 104, h: 42 },
  { id: 'redis', label: 'Timelines', sub: 'Redis lists', x: 468, y: 86, w: 128, h: 42 },
  { id: 'rend', label: 'Renditions', sub: 'immutable keys', x: 236, y: 162, w: 104, h: 42 },
  { id: 'cdn', label: 'CDN', sub: 'cache forever', x: 352, y: 162, w: 104, h: 42 },
  { id: 'follower', label: 'Follower app', sub: 'home feed', x: 468, y: 162, w: 128, h: 42 },
];
const LINKS: [string, string][] = [
  ['app', 'api'],
  ['app', 'store'],
  ['api', 'posts'],
  ['store', 'queue'],
  ['queue', 'worker'],
  ['worker', 'posts'],
  ['worker', 'rend'],
  ['posts', 'kafka'],
  ['kafka', 'fanout'],
  ['fanout', 'redis'],
  ['redis', 'follower'],
  ['rend', 'cdn'],
  ['cdn', 'follower'],
];
const STATUS_TONE: Record<string, Tone> = { none: 'muted', UPLOADING: 'accent', UPLOADED: 'accent', PROCESSING: 'warn', READY: 'good', REVIEW: 'warn', PUBLISHED: 'good', AUTHOR_ONLY: 'warn' };

export default function InstaView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<InstaParams>({ author: 'normal', moderation: 'clean', crash: false });
  const frames = useSimulation(simulateInsta, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const followers = FOLLOWERS[params.author];
  const aria = `Instagram step ${stepper.i + 1}: media ${f.media}, post ${f.post}, ${f.renditions.length} renditions, ${f.timelineInserts} timeline inserts.`;

  return (
    <VizFrame
      title="Instagram: upload, media pipeline, publish, fan-out"
      blurb="Post one photo and follow it from a presigned upload to a follower's feed. Make the author a celebrity, send the photo to human review, or crash the media worker mid-job."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<Author>
            label="Author"
            value={params.author}
            options={[
              { value: 'normal', label: '300 followers' },
              { value: 'celebrity', label: 'Celebrity (50M)' },
            ]}
            onChange={(author) => setParams((p) => ({ ...p, author }))}
          />
          <Choice<Moderation>
            label="Moderation"
            value={params.moderation}
            options={[
              { value: 'clean', label: 'Clean' },
              { value: 'uncertain', label: 'Uncertain' },
            ]}
            onChange={(moderation) => setParams((p) => ({ ...p, moderation }))}
          />
          <Choice<'on' | 'off'>
            label="Worker crash"
            value={params.crash ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, crash: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> request / job
          <Key tone="good" /> stored / published
          <Key tone="warn" /> retry / review / pulled at read
          <Key tone="bad" /> crash
        </>
      }
    >
      <svg viewBox="0 0 600 340" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {LINKS.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {NODES.map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} dim={Object.keys(f.active).length > 0 && !f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={nodes[e.from].y !== nodes[e.to].y ? -6 : nodes[e.from].y === 10 ? 32 : -28} packet k={`${stepper.i}-${k}`} />
        ))}

        <Panel x={8} y={140} w={220} h={196} title="State">
          <text x={18} y={168} fontSize={10} className="adf-muted">
            media m42
          </text>
          <Pill x={90} y={166} text={f.media} tone={STATUS_TONE[f.media]} size={9.5} />
          <text x={18} y={190} fontSize={10} className="adf-muted">
            post
          </text>
          <Pill x={90} y={188} text={f.post} tone={STATUS_TONE[f.post]} size={9.5} />
          <text x={18} y={212} fontSize={10} className="adf-muted">
            job attempts: {f.jobAttempts} · EXIF/GPS {f.exifStripped ? 'stripped' : 'present'}
          </text>
          <text x={18} y={234} fontSize={10} fontWeight={700}>
            Renditions (original {ORIGINAL_KB.toLocaleString('en-US')} KB)
          </text>
          {RENDITIONS.map((r, k) => {
            const has = f.renditions.includes(r.w);
            return (
              <g key={r.w}>
                <text x={18} y={254 + k * 19} fontSize={9.5} fontFamily="var(--f-mono)">
                  {r.w}px
                </text>
                <rect x={64} y={245 + k * 19} width={110} height={11} rx={3} fill="var(--tint)" />
                <rect x={64} y={245 + k * 19} width={has ? Math.max(3, (r.kb / RENDITIONS[0].kb) * 110) : 0} height={11} rx={3} fill="var(--good)" style={{ transition: 'width 0.35s ease' }} />
                <text x={180} y={254 + k * 19} fontSize={9.5} className="adf-muted">
                  {has ? `${r.kb} KB` : '–'}
                </text>
              </g>
            );
          })}
        </Panel>

        <Panel x={236} y={214} w={356} h={122} title={`Fan-out for ${followers.toLocaleString('en-US')} followers`}>
          <text x={248} y={258} fontSize={26} fontWeight={800} style={{ fill: f.timelineInserts ? 'var(--good)' : 'var(--ink)' }}>
            {f.timelineInserts.toLocaleString('en-US')}
          </text>
          <text x={248} y={276} fontSize={10} className="adf-muted">
            timeline inserts at write time
          </text>
          <text x={430} y={258} fontSize={26} fontWeight={800} style={{ fill: f.pulledAtRead ? 'var(--warn)' : 'var(--ink)' }}>
            {f.pulledAtRead ? 'yes' : 'no'}
          </text>
          <text x={430} y={276} fontSize={10} className="adf-muted">
            merged at read time
          </text>
          <text x={248} y={304} fontSize={10} className="adf-muted">
            {followers >= CELEB_THRESHOLD ? `≥ ${CELEB_THRESHOLD / 1e6}M followers: pull (no 50M-insert storm)` : `< ${CELEB_THRESHOLD / 1e6}M followers: push into each timeline`}
          </text>
          <text x={248} y={322} fontSize={10} className="adf-muted">
            publish only after every media item is READY
          </text>
        </Panel>
      </svg>
    </VizFrame>
  );
}
