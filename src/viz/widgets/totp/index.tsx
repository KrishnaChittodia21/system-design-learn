import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, SECRETS, STEP, TIMES, counterAt, simulate, type Params, type SecretId, type Stage, type TotpFrame } from './sim';

const ORDER: Stage[] = ['secret', 'time', 'counter', 'bytes', 'hmac', 'offset', 'slice', 'mod', 'send', 'server-time', 'check', 'verdict', 'replay', 'next'];
const mono = { fontFamily: 'var(--mono)' };
const b2 = (n: number) => n.toString(16).padStart(2, '0');

function Box({ x, y, w, h, title, children, on }: { x: number; y: number; w: number; h: number; title: string; children?: React.ReactNode; on?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={on ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke={on ? 'var(--accent)' : 'var(--border)'} />
      <text x={x + 8} y={y + 14} fontSize={10} fontWeight={700}>
        {title}
      </text>
      {children}
    </g>
  );
}

function Drawing({ f }: { f: TotpFrame }) {
  const s = ORDER.indexOf(f.stage);
  const at = (st: Stage) => s >= ORDER.indexOf(st);
  const is = (...st: Stage[]) => st.includes(f.stage);
  const { h } = f;
  const into = f.phoneTime % STEP;
  const showCode = at('mod');
  const cellW = 27;
  const macX = 30;
  const label = `Phone time ${f.phoneTime}, counter ${h.counter}${showCode ? `, code ${h.code}` : ''}. ${
    f.accepted === null ? '' : f.accepted ? `Server accepted; last used counter ${f.lastUsed}.` : 'Server rejected the code.'
  }${f.replayRejected ? ' Replay rejected.' : ''}`;
  const serverCtr = counterAt(f.serverTime);

  return (
    <svg viewBox="0 0 600 340" className="viz-svg" role="img" aria-label={label}>
      {/* phone */}
      <Box x={4} y={4} w={290} h={62} title="📱 Phone (authenticator app)" on={s <= ORDER.indexOf('send') && s > 0}>
        <text x={12} y={32} fontSize={10} className="viz-label">
          secret {f.secretHex.length > 16 ? f.secretHex.slice(0, 16) + '…' : f.secretHex}
        </text>
        {at('time') && (
          <text x={12} y={47} fontSize={9} style={mono}>
            t = {f.phoneTime}
            {at('counter') ? `  →  T = ${h.counter}` : ''}
          </text>
        )}
        {at('counter') && (
          <g>
            <rect x={12} y={54} width={150} height={5} rx={2} fill="var(--border)" />
            <rect x={12} y={54} width={(150 * (STEP - into)) / STEP} height={5} rx={2} fill={STEP - into <= 5 ? 'var(--warn)' : 'var(--good)'} />
          </g>
        )}
        {showCode && (
          <text x={286} y={46} textAnchor="end" fontSize={20} fontWeight={800} style={{ ...mono, letterSpacing: 1 }}>
            {h.code.slice(0, 3)} {h.code.slice(3)}
          </text>
        )}
      </Box>
      {/* server */}
      <Box x={306} y={4} w={290} h={62} title="🖥 Server" on={at('server-time')}>
        <text x={314} y={32} fontSize={10} className="viz-label">
          same secret (encrypted at rest)
        </text>
        {at('server-time') && (
          <text x={314} y={48} fontSize={10} style={mono}>
            t = {f.serverTime} → T = {serverCtr}
          </text>
        )}
        {f.lastUsed !== null && (
          <text x={588} y={60} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--accent)" style={{ fill: 'var(--accent)' }}>
            last used T = {f.lastUsed}
          </text>
        )}
      </Box>
      {at('send') && !is('next') && (
        <g>
          <line x1={250} y1={66} x2={350} y2={66} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={300} y={78} textAnchor="middle" fontSize={9} className="viz-label">
            code typed in
          </text>
        </g>
      )}

      {/* counter bytes */}
      {at('bytes') && (
        <g>
          <text x={macX - 26} y={98} fontSize={9} className="viz-label">
            msg
          </text>
          {Array.from(h.msg).map((b, i) => (
            <g key={i}>
              <rect x={macX + i * cellW} y={86} width={cellW - 2} height={16} rx={3} fill={is('bytes') ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke="var(--border)" />
              <text x={macX + i * cellW + (cellW - 2) / 2} y={98} textAnchor="middle" fontSize={9.5} style={mono}>
                {b2(b)}
              </text>
            </g>
          ))}
          <text x={macX + 8 * cellW + 6} y={98} fontSize={9} className="viz-label">
            counter {h.counter} as 8-byte big-endian
          </text>
        </g>
      )}
      {/* HMAC */}
      {at('hmac') && (
        <g>
          <text x={macX - 26} y={128} fontSize={9} className="viz-label">
            mac
          </text>
          {Array.from(h.mac).map((b, i) => {
            const inSlice = at('offset') && i >= h.offset && i < h.offset + 4;
            const lastB = at('offset') && i === 19;
            return (
              <g key={i}>
                <rect
                  x={macX + i * cellW}
                  y={116}
                  width={cellW - 2}
                  height={16}
                  rx={3}
                  fill={inSlice ? 'var(--good-soft)' : lastB ? 'var(--warn-soft)' : 'var(--surface-2)'}
                  stroke={inSlice ? 'var(--good)' : lastB ? 'var(--warn)' : 'var(--border)'}
                  strokeWidth={inSlice || lastB ? 1.5 : 1}
                />
                <text x={macX + i * cellW + (cellW - 2) / 2} y={128} textAnchor="middle" fontSize={9.5} style={mono}>
                  {b2(b)}
                </text>
                <text x={macX + i * cellW + (cellW - 2) / 2} y={142} textAnchor="middle" fontSize={7.5} className="viz-label">
                  {i}
                </text>
              </g>
            );
          })}
          {is('hmac') && f.next && (
            <g>
              <text x={macX - 26} y={160} fontSize={9} className="viz-label">
                T+1
              </text>
              {Array.from(f.next.mac).map((b, i) => (
                <g key={i}>
                  <rect x={macX + i * cellW} y={148} width={cellW - 2} height={16} rx={3} fill={b !== h.mac[i] ? 'var(--bad-soft)' : 'var(--surface-2)'} stroke="var(--border)" />
                  <text x={macX + i * cellW + (cellW - 2) / 2} y={160} textAnchor="middle" fontSize={9.5} style={mono}>
                    {b2(b)}
                  </text>
                </g>
              ))}
            </g>
          )}
          {at('offset') && (
            <text x={macX + 19 * cellW + 12} y={158} textAnchor="end" fontSize={9.5} fill="var(--warn)" style={{ fill: 'var(--warn)' }}>
              last byte 0x{b2(h.mac[19])} → low nibble {h.mac[19] & 0xf} = offset
            </text>
          )}
        </g>
      )}
      {/* truncation pipeline */}
      {at('slice') && (
        <g style={mono}>
          <rect x={4} y={172} width={592} height={34} rx={6} fill="var(--surface-2)" stroke="var(--border)" />
          <text x={14} y={193} fontSize={11}>
            0x{h.slice.map(b2).join('')} &amp; 0x7fffffff = {h.bin}
            {at('mod') ? `  →  mod 10^6 = ${h.code}` : ''}
          </text>
        </g>
      )}
      {/* verification */}
      {at('server-time') && (
        <g>
          <text x={8} y={228} fontSize={10} fontWeight={700}>
            Server window (counters it will try)
          </text>
          {[-1, 0, 1].map((d) => {
            const ctr = serverCtr + d;
            const x = 40 + (d + 1) * 180;
            const inWin = Math.abs(d) <= f.window;
            const c = f.checked.find((k) => k.delta === d);
            const phoneHere = ctr === h.counter;
            return (
              <g key={d} opacity={inWin ? 1 : 0.35}>
                <rect
                  x={x}
                  y={236}
                  width={160}
                  height={44}
                  rx={8}
                  fill={c ? (c.match ? 'var(--good-soft)' : 'var(--bad-soft)') : 'var(--surface-2)'}
                  stroke={c ? (c.match ? 'var(--good)' : 'var(--bad)') : 'var(--border)'}
                  strokeDasharray={inWin ? undefined : '4 3'}
                />
                <text x={x + 80} y={252} textAnchor="middle" fontSize={10} fontWeight={700}>
                  T{d === 0 ? '' : d > 0 ? '+1' : '−1'} = {ctr}
                </text>
                <text x={x + 80} y={271} textAnchor="middle" fontSize={13} style={mono}>
                  {c ? `${c.code} ${c.match ? '✓' : '✗'}` : inWin ? '…' : 'outside window'}
                </text>
                {phoneHere && (
                  <text x={x + 80} y={294} textAnchor="middle" fontSize={9.5} fill="var(--accent)" style={{ fill: 'var(--accent)' }}>
                    ▲ phone's counter
                  </text>
                )}
              </g>
            );
          })}
          {h.counter < serverCtr - 1 && (
            <text x={30} y={294} fontSize={9.5} fill="var(--bad)" style={{ fill: 'var(--bad)' }}>
              ◀ phone's counter {h.counter}
            </text>
          )}
          {h.counter > serverCtr + 1 && (
            <text x={570} y={294} textAnchor="end" fontSize={9.5} fill="var(--bad)" style={{ fill: 'var(--bad)' }}>
              phone's counter {h.counter} ▶
            </text>
          )}
        </g>
      )}
      {f.accepted !== null && (
        <g>
          <rect x={4} y={302} width={290} height={32} rx={8} fill={f.accepted ? 'var(--good-soft)' : 'var(--bad-soft)'} stroke={f.accepted ? 'var(--good)' : 'var(--bad)'} />
          <text x={149} y={322} textAnchor="middle" fontSize={11} fontWeight={700}>
            {f.accepted ? `Login ✓ (accepted, T=${f.lastUsed})` : 'Login ✗ (outside window)'}
          </text>
        </g>
      )}
      {at('replay') && f.replayRejected && (
        <g>
          <rect x={306} y={302} width={290} height={32} rx={8} fill="var(--bad-soft)" stroke="var(--bad)" />
          <text x={451} y={322} textAnchor="middle" fontSize={11} fontWeight={700}>
            Replay of {h.code} ✗ (T ≤ last used)
          </text>
        </g>
      )}
      {is('next') && f.next && (
        <text x={588} y={322} textAnchor="end" fontSize={10} className="viz-label" style={{ display: f.replayRejected ? 'none' : undefined }}>
          next step: {f.next.code}
        </text>
      )}
    </svg>
  );
}

export default function TotpViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<SecretId>
            label="Secret"
            value={params.secret}
            options={(Object.keys(SECRETS) as SecretId[]).map((k) => ({ value: k, label: SECRETS[k].label }))}
            onChange={set('secret')}
          />
          <Choice<string>
            label="Unix time"
            value={String(params.time)}
            options={TIMES.map((t) => ({ value: String(t), label: String(t) }))}
            onChange={(v) => set('time')(Number(v))}
          />
          <Slider label="Server clock behind phone" value={params.drift} min={-120} max={120} step={5} onChange={set('drift')} format={(v) => `${v > 0 ? '+' : ''}${v}s`} />
          <Choice<'0' | '1'>
            label="Window"
            value={String(params.window) as '0' | '1'}
            options={[
              { value: '0', label: 'exact step only' },
              { value: '1', label: '±1 step' },
            ]}
            onChange={(v) => set('window')(Number(v) as 0 | 1)}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> last byte → offset
          <span className="viz-key" style={{ background: 'var(--good)' }} /> 4 truncated bytes / match
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> changed byte / mismatch
        </>
      }
    >
      <Drawing f={stepper.frame} />
    </VizFrame>
  );
}
