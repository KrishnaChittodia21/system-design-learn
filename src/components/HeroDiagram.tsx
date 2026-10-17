import { useRef } from 'react';
import { drawPaths, gsap, MOTION_OK, useGSAP } from '../lib/gsap';

const NODES = [
  { id: 'client', x: 0, y: 60, label: 'client' },
  { id: 'edge', x: 104, y: 60, label: 'edge', kind: 'core' },
  { id: 'api-a', x: 212, y: 12, label: 'api' },
  { id: 'api-b', x: 212, y: 108, label: 'api' },
  { id: 'cache', x: 336, y: 12, label: 'cache', kind: 'store' },
  { id: 'db', x: 336, y: 108, label: 'db', kind: 'store' },
] as const;
const W = 72;
const H = 30;

/**
 * The dashboard hero's decorative system sketch: client → edge → two services → cache and database, drawn in
 * thin blueprint wires. GSAP draws the wires, drops the components in, then sends a request "packet" along the
 * read path every few seconds while the sketch is on screen. Static (fully drawn, no packet) with reduced motion.
 */
export function HeroDiagram() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const svg = root.current?.querySelector('svg');
        if (!svg) return;
        const wires = Array.from(svg.querySelectorAll<SVGPathElement>('.hd-wire'));
        const nodes = svg.querySelectorAll('.hd-node');
        const route = svg.querySelector<SVGPathElement>('.hd-route');
        const packet = svg.querySelector<SVGCircleElement>('.hd-packet');
        const tl = gsap.timeline({ delay: 0.45 });
        tl.from(nodes, { autoAlpha: 0, scale: 0.86, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.07, ease: 'back.out(1.6)' });
        tl.add(drawPaths(wires, { duration: 0.9, stagger: 0.1 }), 0.15);
        if (route && packet) {
          const len = route.getTotalLength();
          const pos = { d: 0 };
          const place = () => {
            const p = route.getPointAtLength(pos.d);
            packet.setAttribute('cx', String(p.x));
            packet.setAttribute('cy', String(p.y));
          };
          place();
          gsap.set(packet, { autoAlpha: 0 });
          const loop = gsap
            .timeline({ repeat: -1, repeatDelay: 2.4, paused: true })
            .to(packet, { autoAlpha: 1, duration: 0.2 })
            .to(pos, { d: len, duration: 1.8, ease: 'power1.inOut', onUpdate: place }, 0)
            .to(packet, { autoAlpha: 0, duration: 0.25 }, '-=0.25')
            .set(pos, { d: 0, onComplete: place });
          let started = false;
          tl.call(() => {
            started = true;
            loop.play();
          });
          // only travel while the sketch is visible
          gsap.timeline({
            scrollTrigger: {
              trigger: svg,
              start: 'top bottom',
              end: 'bottom top',
              onToggle: (self) => {
                if (!started) return;
                if (self.isActive) loop.resume();
                else loop.pause();
              },
            },
          });
        }
      });
    },
    { scope: root },
  );
  return (
    <div ref={root} className="hero-diagram" aria-hidden>
      <svg viewBox="-2 0 412 152" focusable="false">
        <path className="hd-wire" d="M72 75 H104" />
        <path className="hd-wire" d="M176 75 H192 Q194 75 194 73 V29 Q194 27 196 27 H212" />
        <path className="hd-wire" d="M176 75 H192 Q194 75 194 77 V121 Q194 123 196 123 H212" />
        <path className="hd-wire" d="M284 27 H336" />
        <path className="hd-wire" d="M284 123 H336" />
        <path className="hd-wire alt" d="M284 33 H306 Q310 33 310 37 V113 Q310 117 314 117 H336" />
        <path className="hd-route" d="M36 75 H194 V27 H372" fill="none" stroke="none" />
        {NODES.map((n) => (
          <g key={n.id} className={`hd-node ${'kind' in n ? n.kind : ''}`}>
            <rect x={n.x} y={n.y} width={W} height={H} rx={8} />
            <text x={n.x + W / 2} y={n.y + H / 2 + 3.5} textAnchor="middle">
              {n.label}
            </text>
          </g>
        ))}
        <circle className="hd-packet" r={4} cx={36} cy={75} />
      </svg>
    </div>
  );
}
