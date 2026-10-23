import { useState, type ReactNode } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Halo, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { simulateNotify, type NotifyParams, type SmsProvider } from './sim';

const STATIC: [string, string][] = [
  ['svc', 'api'],
  ['api', 'prefs'],
  ['api', 'queues'],
  ['queues', 'pushw'],
  ['queues', 'smsw'],
  ['pushw', 'apns'],
  ['smsw', 'twilio'],
  ['smsw', 'msg91'],
  ['smsw', 'dlq'],
];

const TOP = new Set(['svc', 'api', 'prefs']);

export default function NotifyView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<NotifyParams>({ sms: 'flaky', maxAttempts: 5, secondary: true });
  const frames = useSimulation(simulateNotify, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const nodes: Record<string, NodeDef> = {
    svc: { id: 'svc', label: 'Order service', sub: 'txn + outbox', x: 8, y: 22, w: 108, h: 46 },
    api: { id: 'api', label: 'Notification API', sub: 'dedup · prefs', x: 176, y: 22, w: 124, h: 46 },
    prefs: { id: 'prefs', label: 'Redis + prefs', sub: 'claims · opt-outs', x: 356, y: 22, w: 124, h: 46 },
    queues: { id: 'queues', label: 'Channel queues', sub: 'tx | bulk lanes', x: 176, y: 108, w: 126, h: 46 },
    pushw: { id: 'pushw', label: 'Push workers', x: 334, y: 82, w: 124, h: 34 },
    smsw: { id: 'smsw', label: 'SMS workers', x: 334, y: 134, w: 124, h: 34 },
    apns: { id: 'apns', label: 'APNs / FCM', x: 488, y: 82, w: 104, h: 34 },
    twilio: { id: 'twilio', label: 'Twilio', sub: f.breaker === 'open' ? 'breaker OPEN' : 'primary', x: 488, y: 128, w: 104, h: 40 },
    msg91: { id: 'msg91', label: 'MSG91', sub: params.secondary ? 'secondary' : 'not configured', x: 488, y: 180, w: 104, h: 40 },
    dlq: { id: 'dlq', label: 'DLQ + alert', x: 334, y: 186, w: 124, h: 34 },
  };
  const aria = `Notification step ${stepper.i + 1}: push sent ${f.sent.push}, SMS sent ${f.sent.sms}, ${f.attempts.length} SMS attempts, ${f.dlq.length} in the dead-letter queue, breaker ${f.breaker}.`;

  return (
    <VizFrame
      title="Notification service: fan-out, retries and dedup"
      blurb="One 'order shipped' event fans out to push and SMS. Make the SMS provider flaky, down or the number invalid, cap the attempts, and see backoff, the circuit breaker, failover, the DLQ and the duplicate-event check."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<SmsProvider>
            label="SMS provider"
            value={params.sms}
            options={[
              { value: 'healthy', label: 'Healthy' },
              { value: 'flaky', label: 'Flaky (503 ×2)' },
              { value: 'outage', label: 'Outage' },
              { value: 'invalid', label: 'Invalid number' },
            ]}
            onChange={(sms) => setParams((p) => ({ ...p, sms }))}
          />
          <Slider label="Max attempts" value={params.maxAttempts} min={2} max={6} onChange={(maxAttempts) => setParams((p) => ({ ...p, maxAttempts }))} />
          <Choice<'on' | 'off'>
            label="Secondary SMS provider"
            value={params.secondary ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, secondary: v === 'on' }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> message in flight
          <Key tone="good" /> delivered / dedup hit
          <Key tone="warn" /> retryable failure
          <Key tone="bad" /> permanent failure / DLQ
        </>
      }
    >
      <svg viewBox="0 0 600 340" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {STATIC.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {Object.values(nodes).map((n) => (
          <Box
            key={n.id}
            n={n}
            tone={f.active[n.id]}
            dim={(n.id === 'msg91' && !params.secondary) || (Object.keys(f.active).length > 0 && !f.active[n.id])}
          />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={TOP.has(e.from) && TOP.has(e.to) ? -28 : -6} packet k={`${stepper.i}-${k}`} />
        ))}

        {/* queues */}
        <Panel x={8} y={234} w={196} h={102} title="Queues (per channel × priority)">
          {f.queues.map((q, k) => (
            <g key={q.name}>
              <text x={18} y={266 + k * 18} fontSize={10} fontFamily="var(--f-mono)" className="cdf-muted">
                {q.name}
              </text>
              {q.items.length === 0 ? (
                <text x={84} y={266 + k * 18} fontSize={10} className="cdf-muted">
                  empty
                </text>
              ) : (
                q.items.map((it, j) => <Pill key={it} x={84 + j * 60} y={264 + k * 18} text={it} tone={it.startsWith('campaign') ? 'muted' : 'accent'} size={9} />)
              )}
            </g>
          ))}
        </Panel>

        {/* idempotency claims */}
        <Panel x={210} y={234} w={170} h={102} title="Idempotency keys (SET NX)">
          {f.claims.length === 0 && (
            <text x={220} y={266} fontSize={10} className="cdf-muted">
              none claimed
            </text>
          )}
          {f.claims.map((c, k) => (
            <g key={c.key}>
              <text x={220} y={264 + k * 28} fontSize={9.5} fontFamily="var(--f-mono)">
                {c.key}
              </text>
              <Pill x={220} y={278 + k * 28} text={c.state} tone={c.tone} size={9} />
            </g>
          ))}
          <text x={220} y={328} fontSize={9.5} className="cdf-muted">
            sent: push {f.sent.push} · SMS {f.sent.sms} · email 0
          </text>
        </Panel>

        {/* attempts */}
        <Panel x={386} y={234} w={206} h={102} title="SMS attempts">
          {f.attempts.length === 0 && (
            <text x={396} y={266} fontSize={10} className="cdf-muted">
              not sent yet
            </text>
          )}
          {f.attempts.slice(-6).map((a, k) => (
            <g key={a.n} className="cdf-pop">
              <text x={396} y={264 + k * 12} fontSize={9.5} fontFamily="var(--f-mono)">
                #{a.n} t={a.at}s
              </text>
              <Halo x={462} y={264 + k * 12} text={`${a.provider}: ${a.result.split(':')[0]}`} size={9.5} anchor="start" tone={a.tone} weight={700} />
            </g>
          ))}
        </Panel>
      </svg>
    </VizFrame>
  );
}
