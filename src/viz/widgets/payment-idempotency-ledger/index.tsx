import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type Hop, type OrderStatus, type Params, type Webhook } from './sim';

const ORDER_TONE: Record<OrderStatus, string> = {
  NOT_STARTED: 'var(--text-2)',
  PROCESSING: 'var(--warn)',
  FAILED: 'var(--bad)',
  SUCCEEDED: 'var(--good)',
  REFUNDED: 'var(--bad)',
};
const BOX = {
  client: { x: 8, w: 118 },
  svc: { x: 146, w: 204 },
  psp: { x: 370, w: 222 },
};
const ROW1_Y = 8;
const ROW1_H = 136;
const money = (n: number) => n.toLocaleString('en-IN');

function hopLine(hop: Hop): { x1: number; x2: number; y: number; tone: string; dashed?: boolean } | null {
  const cR = BOX.client.x + BOX.client.w;
  const sL = BOX.svc.x;
  const sR = BOX.svc.x + BOX.svc.w;
  const pL = BOX.psp.x;
  switch (hop) {
    case 'client-svc':
      return { x1: cR + 2, x2: sL - 2, y: 60, tone: 'accent' };
    case 'svc-client':
      return { x1: sL - 2, x2: cR + 2, y: 84, tone: 'accent' };
    case 'svc-psp':
      return { x1: sR + 2, x2: pL - 2, y: 60, tone: 'accent' };
    case 'psp-svc':
      return { x1: pL - 2, x2: sR + 2, y: 84, tone: 'good' };
    case 'psp-svc-lost':
      return { x1: pL - 2, x2: sR + 2, y: 84, tone: 'bad', dashed: true };
    default:
      return null;
  }
}

export default function PaymentIdempotencyViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const line = hopLine(f.hop);
  const sumD = f.rows.reduce((a, r) => a + r.debit, 0);
  const sumC = f.rows.reduce((a, r) => a + r.credit, 0);
  const receivable = f.rows.filter((r) => r.account === 'buyer_psp_receivable').reduce((a, r) => a + r.debit - r.credit, 0);
  const charged = f.charges.filter((c) => c.status === 'succeeded' || c.status === 'processing').length;

  const aria = `Orders ${f.orders.map((o) => `${o.id} ${o.status}`).join(', ') || 'none'}. PSP charges ${f.charges.map((c) => `${c.id} ${c.status}`).join(', ') || 'none'}. Ledger ${f.txns.length} transactions, debits ${sumD} equal credits ${sumC}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<'on' | 'off'>
            label="Idempotency"
            value={params.idem ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Keys at every hop' },
              { value: 'off', label: 'None' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, idem: v === 'on' }))}
          />
          <Choice<Webhook>
            label="PSP webhook"
            value={params.webhook}
            options={[
              { value: 'delivered', label: 'Delivered (twice)' },
              { value: 'lost', label: 'Lost' },
            ]}
            onChange={(webhook) => setParams((p) => ({ ...p, webhook }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> request
          <span className="viz-key" style={{ background: 'var(--good)' }} /> PSP callback
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> lost / wrong
          <span>Dr = debit, Cr = credit; reversals flip sides</span>
        </>
      }
    >
      <svg viewBox="0 0 600 344" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          {['accent', 'good', 'bad'].map((c) => (
            <marker key={c} id={`pil-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={`var(--${c})`} />
            </marker>
          ))}
        </defs>

        {/* client */}
        <rect x={BOX.client.x} y={ROW1_Y} width={BOX.client.w} height={ROW1_H} rx={8} fill="var(--surface-2)" stroke={f.hop === 'client-svc' ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.hop === 'client-svc' ? 2 : 1.2} />
        <text x={BOX.client.x + 8} y={ROW1_Y + 16} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          buyer app
        </text>
        <text x={BOX.client.x + 8} y={ROW1_Y + 40} fontSize={10.5}>
          cart #7 · ₹1,000
        </text>
        <foreignObject x={BOX.client.x + 6} y={ROW1_Y + 52} width={BOX.client.w - 12} height={60}>
          <div style={{ font: '600 10.5px/1.35 var(--f-body)', color: charged > 1 || f.clientMsg.includes('refund') ? 'var(--bad)' : f.clientMsg.includes('✓') ? 'var(--good)' : 'var(--text)' }}>{f.clientMsg}</div>
        </foreignObject>
        <text x={BOX.client.x + 8} y={ROW1_Y + ROW1_H - 10} fontSize={10} fontWeight={700} style={{ fill: charged > 1 ? 'var(--bad)' : 'var(--text-2)' }}>
          card charges: {charged}
        </text>

        {/* payment service */}
        <rect x={BOX.svc.x} y={ROW1_Y} width={BOX.svc.w} height={ROW1_H} rx={8} fill="var(--surface-2)" stroke={f.hop && f.hop !== 'recon' ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.hop && f.hop !== 'recon' ? 2 : 1.2} />
        <text x={BOX.svc.x + 8} y={ROW1_Y + 16} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          payment service
        </text>
        <text x={BOX.svc.x + 8} y={ROW1_Y + 34} fontSize={9.5} style={{ fill: 'var(--muted)' }}>
          idempotency_keys (UNIQUE)
        </text>
        <text x={BOX.svc.x + 8} y={ROW1_Y + 49} fontSize={10.5}>
          {f.idemKeys.length ? f.idemKeys.map((k) => `${k.key} → ${k.response}`).join(' · ') : params.idem ? '—' : 'not used'}
        </text>
        <text x={BOX.svc.x + 8} y={ROW1_Y + 70} fontSize={9.5} style={{ fill: 'var(--muted)' }}>
          payment_orders
        </text>
        {f.orders.map((o, i) => (
          <text key={o.id} x={BOX.svc.x + 8} y={ROW1_Y + 86 + i * 16} fontSize={10.5}>
            {o.id} <tspan fontWeight={700} style={{ fill: ORDER_TONE[o.status] }}>{o.status}</tspan>
          </text>
        ))}

        {/* PSP */}
        <rect x={BOX.psp.x} y={ROW1_Y} width={BOX.psp.w} height={ROW1_H} rx={8} fill="var(--surface-2)" stroke={f.hop === 'svc-psp' || f.hop?.startsWith('psp') ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.hop === 'svc-psp' || f.hop?.startsWith('psp') ? 2 : 1.2} />
        <text x={BOX.psp.x + 8} y={ROW1_Y + 16} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          PSP (card network)
        </text>
        {f.charges.map((c, i) => (
          <text key={c.id} x={BOX.psp.x + 8} y={ROW1_Y + 36 + i * 16} fontSize={10.5}>
            {c.id} for {c.order} ₹1,000{' '}
            <tspan fontWeight={700} style={{ fill: c.status === 'succeeded' ? 'var(--good)' : c.status === 'refunded' ? 'var(--bad)' : 'var(--warn)' }}>
              {c.status}
            </tspan>
          </text>
        ))}
        <text x={BOX.psp.x + 8} y={ROW1_Y + 80} fontSize={9.5} style={{ fill: 'var(--muted)' }}>
          webhooks sent
        </text>
        {f.events.slice(-3).map((e, i) => (
          <text key={i} x={BOX.psp.x + 8} y={ROW1_Y + 96 + i * 14} fontSize={10}>
            {e}
          </text>
        ))}
        {f.hop === 'psp-svc-lost' && (
          <text x={BOX.psp.x + 8} y={ROW1_Y + 96} fontSize={10} fontWeight={700} style={{ fill: 'var(--bad)' }}>
            ✕ endpoint down, retries exhausted
          </text>
        )}

        {/* hop arrow + label */}
        {line && (
          <line
            x1={line.x1}
            y1={line.y}
            x2={line.x2}
            y2={line.y}
            stroke={`var(--${line.tone})`}
            strokeWidth={2.5}
            strokeDasharray={line.dashed ? '5 4' : undefined}
            markerEnd={`url(#pil-arrow-${line.tone})`}
          />
        )}
        <text x={300} y={ROW1_Y + ROW1_H + 16} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="var(--f-mono)" style={{ fill: f.hop === 'psp-svc-lost' ? 'var(--bad)' : 'var(--accent)' }}>
          {f.hopLabel}
        </text>

        {/* ledger */}
        <rect x={8} y={170} width={384} height={166} rx={8} fill="var(--surface-2)" stroke={f.freshTxns.length ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.freshTxns.length ? 2 : 1.2} />
        <text x={16} y={186} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          double-entry ledger (append-only)
        </text>
        {['txn', 'receivable', 'seller_42', 'fee', 'external_ref'].map((h, i) => (
          <text key={h} x={[16, 50, 124, 194, 248][i]} y={203} fontSize={9.5} style={{ fill: 'var(--muted)' }}>
            {h}
          </text>
        ))}
        {f.txns.slice(-6).map((t, i) => {
          const y = 220 + i * 16;
          const fresh = f.freshTxns.includes(t.id);
          const side = (dr: boolean) => (t.sign === 1 ? dr : !dr) ? 'Dr' : 'Cr';
          return (
            <g key={t.id}>
              {fresh && <rect x={12} y={y - 12} width={376} height={16} rx={3} fill="var(--accent-soft)" />}
              <text x={16} y={y} fontSize={10.5} fontWeight={700} style={{ fill: t.sign === -1 ? 'var(--bad)' : 'var(--text)' }}>
                {t.id}
              </text>
              <text x={50} y={y} fontSize={10.5}>
                {side(true)} {money(1000)}
              </text>
              <text x={124} y={y} fontSize={10.5}>
                {side(false)} {money(980)}
              </text>
              <text x={194} y={y} fontSize={10.5}>
                {side(false)} 20
              </text>
              <text x={248} y={y} fontSize={10} style={{ fill: t.sign === -1 ? 'var(--bad)' : 'var(--text-2)' }}>
                {t.ref}
              </text>
            </g>
          );
        })}
        {f.txns.length === 0 && (
          <text x={16} y={222} fontSize={10.5} style={{ fill: 'var(--muted)' }}>
            no entries yet
          </text>
        )}
        <line x1={16} y1={316} x2={384} y2={316} stroke="var(--border)" />
        <text x={16} y={330} fontSize={10.5} fontWeight={700} style={{ fill: sumD === sumC ? 'var(--good)' : 'var(--bad)' }}>
          Σ Dr {money(sumD)} = Σ Cr {money(sumC)} {sumD === sumC ? '✓ balanced' : '✗'}
        </text>
        <text x={384} y={330} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: receivable === 1000 || receivable === 0 ? 'var(--text)' : 'var(--bad)' }}>
          receivable ₹{money(receivable)}
        </text>

        {/* reconciliation */}
        <rect x={402} y={170} width={190} height={166} rx={8} fill={f.hop === 'recon' ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke={f.hop === 'recon' ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.hop === 'recon' ? 2 : 1.2} />
        <text x={410} y={186} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          nightly reconciliation
        </text>
        {f.findings.length === 0 && (
          <text x={410} y={206} fontSize={10.5} style={{ fill: 'var(--muted)' }}>
            runs against the PSP settlement file
          </text>
        )}
        {f.findings.map((x, i) => (
          <foreignObject key={i} x={408} y={194 + i * 34} width={180} height={34}>
            <div style={{ font: '600 10.5px/1.3 var(--f-body)', color: `var(--${x.tone})` }}>{x.text}</div>
          </foreignObject>
        ))}
      </svg>
    </VizFrame>
  );
}
