import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { simulate, type Approach, type Frame, type KeyScope, type Params, type Tenant } from './sim';

const TENANT: Record<Tenant, string> = { acme: 'var(--accent)', globex: 'var(--mag)' };
const DB_X = 330;
const DB_W = 266;
const ROW_Y = 50;
const ROW_H = 30;

function Drawing({ f, params }: { f: Frame; params: Params }) {
  const active = new Set(f.active);
  const tenantOfKek = (name: string): Tenant | null => (name.endsWith('acme') ? 'acme' : name.endsWith('globex') ? 'globex' : null);
  const aria =
    `Step ${f.step}. KMS calls ${f.kmsCalls}. KEKs: ${f.keks.map((k) => `${k.name} v${k.version}${k.deleted ? ' deleted' : ''}`).join(', ')}. ` +
    f.rows.map((r) => `${r.id} ${r.tenant} ${r.stored ? (r.readable ? 'readable' : 'unreadable') : 'not stored'} ${r.note}`).join('; ') +
    (f.alert ? `. ${f.alert.text}` : '');
  return (
    <svg viewBox="0 0 600 334" className="viz-svg" role="img" aria-label={aria}>
      <defs>
        <marker id="env-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
        </marker>
      </defs>
      {/* app */}
      <rect x={4} y={40} width={138} height={150} rx={10} fill="var(--surface)" stroke="var(--border-strong)" />
      <text x={14} y={60} fontSize={11.5} fontWeight={700}>
        app service
      </text>
      <text x={14} y={76} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
        {params.approach === 'direct' ? 'no local crypto' : 'AES-256-GCM locally'}
      </text>
      <text x={14} y={100} fontSize={9.5} fontWeight={700}>
        DEK cache
      </text>
      {params.approach !== 'cached' ? (
        <text x={14} y={118} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
          {params.approach === 'direct' ? 'n/a' : 'none — DEK zeroed after use'}
        </text>
      ) : f.cache.length === 0 ? (
        <text x={14} y={118} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
          empty
        </text>
      ) : (
        f.cache.map((c, i) => {
          const t = c.endsWith('acme') ? 'acme' : 'globex';
          return (
            <g key={c}>
              <rect x={14} y={108 + i * 24} width={110} height={19} rx={9.5} fill="var(--surface-2)" stroke={TENANT[t]} />
              <text x={69} y={121 + i * 24} textAnchor="middle" fontSize={9.5} fontWeight={700}>
                🔑 {c} (plaintext)
              </text>
            </g>
          );
        })
      )}
      {/* app ↔ KMS */}
      <line x1={144} y1={110} x2={176} y2={110} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#env-arrow)" />
      <text x={4} y={24} fontSize={10} fontWeight={700} style={{ fill: f.calls.includes('Exception') ? 'var(--bad)' : 'var(--accent)' }}>
        {f.calls ? `→ KMS: ${f.calls}` : ' '}
      </text>
      {/* KMS */}
      <rect x={178} y={40} width={136} height={150} rx={10} fill="var(--warn-soft)" stroke="var(--warn)" />
      <text x={188} y={60} fontSize={11.5} fontWeight={700}>
        KMS (HSM)
      </text>
      <text x={188} y={76} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
        KEKs never leave
      </text>
      {f.keks.map((k, i) => {
        const t = tenantOfKek(k.name);
        return (
          <g key={k.name}>
            <rect x={188} y={90 + i * 30} width={116} height={24} rx={6} fill={k.deleted ? 'var(--bad-soft)' : 'var(--surface)'} stroke={k.deleted ? 'var(--bad)' : t ? TENANT[t] : 'var(--text-2)'} strokeWidth={1.6} />
            <text x={196} y={106 + i * 30} fontSize={10} fontWeight={700} style={{ textDecoration: k.deleted ? 'line-through' : undefined }}>
              🗝 {k.name}
            </text>
            <text x={298} y={106 + i * 30} textAnchor="end" fontSize={9.5} style={{ fill: k.deleted ? 'var(--bad)' : 'var(--text-2)' }}>
              {k.deleted ? 'deleted' : `v${k.version}`}
            </text>
          </g>
        );
      })}
      {/* DB */}
      <text x={DB_X} y={24} fontSize={11.5} fontWeight={700}>
        database rows {f.step === 'dump' ? '— stolen dump' : ''}
      </text>
      <text x={DB_X} y={40} fontSize={9} style={{ fill: 'var(--text-2)' }}>
        {params.approach === 'direct' ? 'id · tenant · KMS ciphertext' : 'id · tenant · {wrapped DEK, iv, tag, ciphertext}'}
      </text>
      {f.rows.map((r, i) => {
        const y = ROW_Y + i * ROW_H;
        const on = active.has(r.id);
        const bad = !r.stored || r.note.startsWith('holds') || r.note.startsWith('tampered');
                return (
          <g key={r.id} opacity={r.stored ? 1 : 0.7}>
            <rect x={DB_X} y={y} width={DB_W} height={ROW_H - 5} rx={6} fill={bad ? 'var(--bad-soft)' : 'var(--surface)'} stroke={on ? 'var(--accent)' : 'var(--border)'} strokeWidth={on ? 2 : 1} />
            <rect x={DB_X} y={y} width={5} height={ROW_H - 5} rx={2} fill={TENANT[r.tenant]} />
            <text x={DB_X + 12} y={y + 16} fontSize={10.5} fontWeight={700}>
              {r.id}
            </text>
            <text x={DB_X + 34} y={y + 16} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
              {r.tenant} · {r.kb} KB
            </text>
            <text x={DB_X + 100} y={y + 16} fontSize={9.5} style={{ fill: bad ? 'var(--bad)' : 'var(--text)' }}>
              {!r.stored ? '✗ not stored' : `🔒 ${r.dek ? `${r.dek} · ${r.kek}` : r.kek} v${r.kekVersion}`}
            </text>
            <text x={DB_X + DB_W - 6} y={y + 16} textAnchor="end" fontSize={9} fontWeight={700} style={{ fill: !r.readable ? 'var(--bad)' : 'var(--good)' }}>
              {r.stored ? (r.readable ? '✓ reads' : '✗ locked') : ''}
            </text>
          </g>
        );
      })}
      {/* alert */}
      {f.alert && (
        <g>
          <rect
            x={4}
            y={242}
            width={592}
            height={30}
            rx={8}
            fill={f.alert.tone === 'good' ? 'var(--good-soft)' : f.alert.tone === 'bad' ? 'var(--bad-soft)' : 'var(--warn-soft)'}
            stroke={f.alert.tone === 'good' ? 'var(--good)' : f.alert.tone === 'bad' ? 'var(--bad)' : 'var(--warn)'}
          />
          <text x={300} y={261} textAnchor="middle" fontSize={11} fontWeight={700} style={{ fill: f.alert.tone === 'good' ? 'var(--good)' : f.alert.tone === 'bad' ? 'var(--bad)' : 'var(--warn)' }}>
            {f.alert.text}
          </text>
        </g>
      )}
      <text x={300} y={300} textAnchor="middle" fontSize={11.5} fontWeight={700}>
        KMS calls {f.kmsCalls} · {f.kmsMs} ms on the network · {f.kmsBytes >= 1024 ? `${(f.kmsBytes / 1024).toFixed(1)} KB` : `${f.kmsBytes} B`} sent to KMS
      </text>
      <text x={300} y={320} textAnchor="middle" fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
        dek-n · kek-x = data key wrapped by that KEK · KMS Encrypt max 4 KB · ~10 ms and a quota slot per call
      </text>
    </svg>
  );
}

export default function EnvelopeEncryptionViz() {
  const [params, setParams] = useState<Params>({ approach: 'envelope', keyScope: 'tenant', aad: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Approach>
            label="Encrypt with"
            value={params.approach}
            options={[
              { value: 'direct', label: 'KMS Encrypt per record' },
              { value: 'envelope', label: 'Envelope (DEK per record)' },
              { value: 'cached', label: 'Envelope + DEK cache' },
            ]}
            onChange={(approach) => setParams((p) => ({ ...p, approach }))}
          />
          <Choice<KeyScope>
            label="KEK"
            value={params.keyScope}
            options={[
              { value: 'tenant', label: 'Per tenant' },
              { value: 'shared', label: 'One shared' },
            ]}
            onChange={(keyScope) => setParams((p) => ({ ...p, keyScope }))}
          />
          <Choice<'off' | 'on'>
            label="Encryption context (AAD)"
            value={params.aad ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: '{tenant, record}' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, aad: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> tenant acme
          <span className="viz-key" style={{ background: 'var(--mag)' }} /> tenant globex
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> KMS / HSM
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> failed, tampered or destroyed
        </>
      }
    >
      <Drawing f={stepper.frame} params={params} />
    </VizFrame>
  );
}
