import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CANDIDATES, CRITERIA, RUNGS, simulate, type AliasMode, type Frame, type Msg, type Params } from './sim';
import './hld.css';

const PX = 186; // right panel x
const PW = 406;
const H = 330;
const mono = { fontFamily: 'var(--mono)' };

function ClassBox({
  x,
  y,
  w,
  name,
  stereo,
  members = [],
  tone = 'normal',
}: {
  x: number;
  y: number;
  w: number;
  name: string;
  stereo?: string;
  members?: string[];
  tone?: 'normal' | 'iface' | 'new' | 'focus';
}) {
  const head = stereo ? 30 : 22;
  const h = head + members.length * 14 + (members.length ? 6 : 0);
  const stroke = tone === 'iface' ? 'var(--accent)' : tone === 'new' ? 'var(--good)' : tone === 'focus' ? 'var(--warn)' : 'var(--border)';
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        fill={tone === 'new' ? 'var(--good-soft)' : 'var(--surface)'}
        stroke={stroke}
        strokeWidth={tone === 'normal' ? 1.2 : 1.8}
        strokeDasharray={tone === 'new' ? '5 3' : undefined}
      />
      {stereo && (
        <text x={x + w / 2} y={y + 11} textAnchor="middle" className="viz-label" style={{ fontSize: 9, fontStyle: 'italic' }}>
          «{stereo}»
        </text>
      )}
      <text x={x + w / 2} y={y + (stereo ? 24 : 15)} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800 }}>
        {name}
      </text>
      {members.length > 0 && <line x1={x} x2={x + w} y1={y + head} y2={y + head} stroke={stroke} strokeWidth={0.8} />}
      {members.map((m, k) => (
        <text key={k} x={x + 6} y={y + head + 12 + k * 14} style={{ fontSize: 9.5, ...mono }}>
          {m}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, kind = 'uses' }: { x1: number; y1: number; x2: number; y2: number; kind?: 'uses' | 'implements' | 'owns' }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="var(--text-2)"
      strokeWidth={1.3}
      strokeDasharray={kind === 'owns' ? undefined : '5 3'}
      markerEnd={kind === 'implements' ? 'url(#hz-tri)' : kind === 'uses' ? 'url(#hz-open)' : undefined}
      markerStart={kind === 'owns' ? 'url(#hz-diamond)' : undefined}
    />
  );
}

function Lines({ x, y, title, lines, color }: { x: number; y: number; title: string; lines: string[]; color: string }) {
  return (
    <g>
      <text x={x} y={y} style={{ fontSize: 11, fontWeight: 800, fill: color }}>
        {title}
      </text>
      {lines.map((l, k) => (
        <text key={k} x={x} y={y + 18 + k * 16} style={{ fontSize: 10.5 }}>
          • {l}
        </text>
      ))}
    </g>
  );
}

const LANES: Record<Msg['from'], { x: number; name: string }> = {
  A: { x: PX + 30, name: 'Ann' },
  B: { x: PX + 100, name: 'Bo' },
  svc: { x: PX + 220, name: 'ShorteningService' },
  repo: { x: PX + 350, name: 'LinkRepository' },
};
const MSG_COLOR = { call: 'var(--accent)', ok: 'var(--good)', bad: 'var(--bad)' };

function panel(f: Frame, alias: AliasMode): ReactNode {
  switch (f.rung) {
    case 'hld': {
      const cw = 32;
      const nx = PX + 6;
      const cx0 = PX + 214;
      return (
        <g>
          <text x={PX} y={34} style={{ fontSize: 11, fontWeight: 800 }}>
            Which box holds the class design?
          </text>
          {CRITERIA.map((c, i) => (
            <text key={c} x={cx0 + i * cw + cw / 2} y={56} textAnchor="middle" className="viz-label" style={{ fontSize: 9 }}>
              {c}
            </text>
          ))}
          {CANDIDATES.map((c, r) => {
            const y = 72 + r * 46;
            const total = c.score.filter(Boolean).length;
            const win = r === 0;
            return (
              <g key={c.name}>
                <rect x={PX} y={y - 6} width={PW} height={40} rx={8} fill={win ? 'var(--warn-soft)' : 'transparent'} stroke={win ? 'var(--warn)' : 'var(--border)'} strokeWidth={win ? 1.6 : 0.8} />
                <text x={nx} y={y + 10} style={{ fontSize: 11, fontWeight: 700 }}>
                  {c.name}
                </text>
                <text x={nx} y={y + 25} className="viz-label" style={{ fontSize: 9.5 }}>
                  {c.why}
                </text>
                {c.score.map((s, i) => (
                  <circle key={i} cx={cx0 + i * cw + cw / 2} cy={y + 13} r={6} fill={s ? 'var(--good)' : 'transparent'} stroke={s ? 'var(--good)' : 'var(--border)'} strokeWidth={1.4} />
                ))}
                <text x={PX + PW - 10} y={y + 18} textAnchor="end" style={{ fontSize: 13, fontWeight: 800, ...mono, fill: win ? 'var(--warn)' : 'var(--muted)' }}>
                  {total}/5
                </text>
              </g>
            );
          })}
        </g>
      );
    }
    case 'req':
      return (
        <g>
          <Lines
            x={PX + 4}
            y={36}
            title="Functional"
            color="var(--accent)"
            lines={['shorten(longUrl, opts?) → code', 'optional custom alias', 'optional expiry', 'resolve(code) → url | not found | expired', 'per-user listing, click counting']}
          />
          <Lines
            x={PX + 4}
            y={154}
            title="Non-functional"
            color="var(--good)"
            lines={['7-char base62 ≈ 3.5 × 10¹² codes', 'resolve: no extra I/O on the hot path', 'aliases globally unique', 'same URL, different users → different codes']}
          />
          <Lines x={PX + 4} y={256} title="Out of scope (said out loud)" color="var(--bad)" lines={['auth, UI, malware scanning', 'custom domains → kept as an extension']} />
        </g>
      );
    case 'api': {
      const rows = [
        ['Create a short link', 'shorten(cmd): ShortLink'],
        ['Follow a link', 'resolve(code): TargetUrl'],
        ['', '  throws NotFound | Expired'],
        ['See my links', 'listByOwner(ownerId)'],
      ];
      return (
        <g>
          <text x={PX} y={34} style={{ fontSize: 11, fontWeight: 800 }}>
            Use case → public method of ShorteningService
          </text>
          {rows.map(([u, m], k) => (
            <g key={k}>
              {u && (
                <>
                  <rect x={PX} y={52 + k * 44} width={150} height={30} rx={15} fill="var(--surface-2)" stroke="var(--border)" />
                  <text x={PX + 75} y={71 + k * 44} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 700 }}>
                    {u}
                  </text>
                  <Arrow x1={PX + 152} y1={67 + k * 44} x2={PX + 190} y2={67 + k * 44} />
                </>
              )}
              <text x={PX + 196} y={(u ? 71 : 57) + k * 44} style={{ fontSize: 10.5, ...mono, fill: u ? 'var(--text)' : 'var(--muted)' }}>
                {m}
              </text>
            </g>
          ))}
          <text x={PX} y={250} className="viz-label" style={{ fontSize: 10.5 }}>
            3–6 operations; each becomes a method, nothing else is public.
          </text>
        </g>
      );
    }
    case 'entities':
      return (
        <g>
          <ClassBox x={PX} y={30} w={196} name="ShortLink" stereo="entity · identity = code" members={['code: ShortCode', 'targetUrl: TargetUrl', 'ownerId, createdAt', 'expiresAt?, isCustom', 'isExpired(now): boolean']} tone="focus" />
          <ClassBox x={PX + 212} y={30} w={194} name="ShortCode" stereo="value object" members={['base62, length 4–30', 'not a reserved word']} />
          <ClassBox x={PX + 212} y={112} w={194} name="TargetUrl" stereo="value object" members={['http/https only', 'parsed + normalised']} />
          <ClassBox x={PX + 212} y={194} w={194} name="ClickEvent" stereo="value object" members={['emitted, not stored here']} />
          <text x={PX} y={184} style={{ fontSize: 10.5 }}>
            nouns → classes
          </text>
          <text x={PX} y={202} style={{ fontSize: 10.5 }}>
            verbs → methods: shorten, resolve,
          </text>
          <text x={PX} y={218} style={{ fontSize: 10.5 }}>
            isExpired (behaviour lives with data)
          </text>
        </g>
      );
    case 'classes':
      return (
        <g>
          <ClassBox x={PX + 120} y={28} w={170} name="ShorteningService" members={['+shorten(cmd)', '+resolve(code)', '+listByOwner(owner)']} tone="focus" />
          <ClassBox x={PX + 120} y={142} w={170} name="ShortLink" members={['isExpired(now)']} />
          <ClassBox x={PX} y={240} w={150} name="ShortCode" stereo="VO" />
          <ClassBox x={PX + 256} y={240} w={150} name="TargetUrl" stereo="VO" />
          <Arrow x1={PX + 205} y1={96} x2={PX + 205} y2={140} />
          <text x={PX + 212} y={122} className="viz-label" style={{ fontSize: 9.5 }}>
            creates / returns
          </text>
          <Arrow x1={PX + 160} y1={184} x2={PX + 90} y2={238} kind="owns" />
          <Arrow x1={PX + 250} y1={184} x2={PX + 320} y2={238} kind="owns" />
          <text x={PX + 60} y={214} className="viz-label" style={{ fontSize: 9.5 }}>
            ◆ composition
          </text>
        </g>
      );
    case 'seams':
    case 'patterns':
    case 'ext': {
      const ifaces = [
        { name: 'CodeGenerator', m: 'next(): string', pattern: 'Strategy', impls: ['Counter62', 'Random'], add: 'HashGenerator' },
        { name: 'LinkRepository', m: 'insertIfAbsent()', pattern: 'Repository', impls: ['InMemory', 'Postgres'], add: null },
        { name: 'LinkEventListener', m: 'onClick(e)', pattern: 'Observer', impls: ['Analytics'], add: 'AuditListener' },
      ];
      const showImpl = f.rung !== 'seams';
      return (
        <g>
          <ClassBox x={PX + 110} y={26} w={186} name="ShorteningService" members={f.rung === 'ext' ? ['shorten · resolve', 'expiry via clock.now()'] : ['shorten · resolve']} tone="focus" />
          {f.rung === 'seams' && (
            <>
              <ClassBox x={PX + 312} y={26} w={94} name="Clock" stereo="interface" members={['now()']} tone="iface" />
              <Arrow x1={PX + 296} y1={50} x2={PX + 310} y2={50} />
            </>
          )}
          {ifaces.map((it, k) => {
            const x = PX + k * 138;
            return (
              <g key={it.name}>
                <Arrow x1={PX + 203} y1={74} x2={x + 64} y2={112} />
                {showImpl && (
                  <text x={x + 2} y={108} style={{ fontSize: 10, fontWeight: 800, fill: 'var(--warn)' }}>
                    {it.pattern}
                  </text>
                )}
                <ClassBox x={x} y={114} w={130} name={it.name} stereo="interface" members={[it.m]} tone="iface" />
                {showImpl &&
                  it.impls.map((im, j) => {
                    const bw = it.impls.length > 1 ? 61 : 122;
                    const bx = x + 4 + j * 65;
                    return (
                      <g key={im}>
                        <ClassBox x={bx} y={192} w={bw} name={im} />
                        <Arrow x1={bx + bw / 2} y1={192} x2={x + 65 + (j - (it.impls.length - 1) / 2) * 30} y2={166} kind="implements" />
                      </g>
                    );
                  })}
                {f.rung === 'ext' && it.add && <ClassBox x={x + 4} y={226} w={122} name={`+ ${it.add}`} tone="new" />}
              </g>
            );
          })}
          {f.rung === 'seams' && (
            <text x={PX} y={210} className="viz-label" style={{ fontSize: 10.5 }}>
              DIP: the service depends only on these; it never knows Map vs Postgres.
            </text>
          )}
          {f.rung === 'ext' && (
            <text x={PX} y={316} style={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--good)' }}>
              follow-ups = new classes + wiring in app.ts · 0 existing classes edited
            </text>
          )}
        </g>
      );
    }
    case 'race': {
      const top = 46;
      return (
        <g>
          <text x={PX} y={20} style={{ fontSize: 11, fontWeight: 800 }}>
            {alias === 'naive' ? 'Naive: findByCode, then save' : 'Atomic: insertIfAbsent'}
          </text>
          {Object.entries(LANES).map(([k, l]) => (
            <g key={k}>
              <text x={l.x} y={top - 8} textAnchor="middle" style={{ fontSize: 10, fontWeight: 800 }}>
                {l.name}
              </text>
              <line x1={l.x} x2={l.x} y1={top} y2={H - 50} stroke="var(--border)" strokeDasharray="3 3" />
            </g>
          ))}
          {f.msgs.map((m, k) => {
            const y = top + 14 + k * 22;
            const a = LANES[m.from].x;
            const b = LANES[m.to].x;
            const latest = k === f.msgs.length - 1;
            return (
              <g key={k} opacity={latest ? 1 : 0.55}>
                <line x1={a} x2={b + (b > a ? -4 : 4)} y1={y} y2={y} stroke={MSG_COLOR[m.tone]} strokeWidth={latest ? 2 : 1.3} markerEnd={`url(#hz-msg-${m.tone})`} />
                <text x={(a + b) / 2} y={y - 4} textAnchor="middle" style={{ fontSize: 9.5, ...mono, fontWeight: latest ? 700 : 400, fill: MSG_COLOR[m.tone] }}>
                  {m.label}
                </text>
              </g>
            );
          })}
          <rect x={PX} y={H - 40} width={PW} height={30} rx={8} fill={f.stored?.includes('Bo') && alias === 'naive' ? 'var(--bad-soft)' : 'var(--surface-2)'} stroke="var(--border)" />
          <text x={PX + 10} y={H - 20} style={{ fontSize: 11, ...mono }}>
            links['sale'] = {f.stored ?? '(none)'}
          </text>
        </g>
      );
    }
  }
}

export default function HldToLldZoomViz() {
  const [params, setParams] = useState<Params>({ alias: 'naive' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const rungIdx = RUNGS.findIndex((r) => r.id === f.rung);
  const zoomed = f.rung !== 'hld';
  const hld = [
    { name: 'Client', x: 8, y: 30, w: 160 },
    { name: 'Shortening', x: 92, y: 80, w: 76, focus: true },
    { name: 'Redirect', x: 8, y: 80, w: 76 },
    { name: 'IdGenerator', x: 92, y: 132, w: 76 },
    { name: 'Cache', x: 8, y: 132, w: 76 },
    { name: 'LinkStore (KV)', x: 8, y: 184, w: 160 },
    { name: 'Analytics', x: 92, y: 236, w: 76 },
  ];
  const ariaLabel = `Rung ${rungIdx} of 8, ${RUNGS[rungIdx].label}. ${f.caption}`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Choice<AliasMode>
          label="Custom alias save (rung 7)"
          value={params.alias}
          options={[
            { value: 'naive', label: 'Find, then save' },
            { value: 'atomic', label: 'insertIfAbsent' },
          ]}
          onChange={(alias) => setParams({ alias })}
        />
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> zoomed box / focus
          <span className="viz-key" style={{ background: 'var(--accent)', borderRadius: 2 }} /> interface (seam)
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> additive change
        </>
      }
    >
      <nav className="hz-rungs" aria-label="Rungs of the HLD to LLD ladder">
        {RUNGS.map((r) => {
          const first = frames.findIndex((x) => x.rung === r.id);
          return (
            <button
              key={r.id}
              type="button"
              className={`hz-rung ${r.id === f.rung ? 'on' : ''} ${r.n < rungIdx ? 'done' : ''}`}
              aria-current={r.id === f.rung ? 'step' : undefined}
              onClick={() => stepper.seek(first)}
            >
              <span className="hz-n">{r.n}</span> {r.label}
            </button>
          );
        })}
      </nav>
      <svg viewBox={`0 0 600 ${H}`} className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          <marker id="hz-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="none" stroke="var(--text-2)" strokeWidth={1.5} />
          </marker>
          <marker id="hz-tri" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M1,1 L11,6 L1,11 z" fill="var(--surface)" stroke="var(--text-2)" strokeWidth={1.2} />
          </marker>
          <marker id="hz-diamond" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="11" markerHeight="8" orient="auto">
            <path d="M1,5 L7,1 L13,5 L7,9 z" fill="var(--text-2)" />
          </marker>
          {(['call', 'ok', 'bad'] as const).map((t) => (
            <marker key={t} id={`hz-msg-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={MSG_COLOR[t]} />
            </marker>
          ))}
        </defs>
        <text x={8} y={16} className="viz-label" style={{ fontSize: 10.5 }}>
          HLD: URL shortener
        </text>
        {hld.map((b) => (
          <g key={b.name}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={36}
              rx={6}
              fill={b.focus && zoomed ? 'var(--warn-soft)' : 'var(--surface)'}
              stroke={b.focus ? 'var(--warn)' : 'var(--border)'}
              strokeWidth={b.focus ? 2 : 1}
            />
            <text x={b.x + b.w / 2} y={b.y + 22} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: b.focus ? 800 : 600 }}>
              {b.name}
            </text>
          </g>
        ))}
        <line x1={88} y1={66} x2={88} y2={80} stroke="var(--border)" />
        <line x1={46} y1={116} x2={46} y2={132} stroke="var(--border)" />
        <line x1={46} y1={168} x2={46} y2={184} stroke="var(--border)" />
        <line x1={130} y1={116} x2={130} y2={132} stroke="var(--border)" />
        <line x1={130} y1={168} x2={130} y2={184} stroke="var(--border)" />
        <line x1={130} y1={220} x2={130} y2={236} stroke="var(--border)" strokeDasharray="3 3" />
        {zoomed && (
          <>
            <path d={`M168,98 L${PX - 4},98`} stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#hz-open)" />
            <rect x={PX - 4} y={4} width={PW + 8} height={H - 8} rx={10} fill="none" stroke="var(--warn)" strokeOpacity={0.35} />
          </>
        )}
        <text x={8} y={300} className="viz-label" style={{ fontSize: 10 }}>
          rung {rungIdx}/8 · {RUNGS[rungIdx].label}
        </text>
        {panel(f, params.alias)}
      </svg>
    </VizFrame>
  );
}
