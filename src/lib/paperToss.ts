// "Paper toss": crumpled paper balls lob into a see-through dustbin and pile up inside; the last one clips the rim
// and rolls away. Drawn on a canvas the caller owns; lazy-loaded by commiserate.ts so it stays out of the main bundle.

interface Options {
  count?: number;
  ms?: number;
  /** px kept clear at the bottom of the canvas (e.g. the mobile tab bar) */
  bottomInset?: number;
}

interface Ball {
  i: number;
  start: number;
  dur: number;
  x0: number;
  y0: number;
  r: number;
  rot: number;
  last: boolean;
  done: boolean;
}

interface Landed {
  ball: Ball;
  x0: number;
  y0: number;
  slot: { dx: number; dy: number };
  t0: number;
}

interface Tossed {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
}

const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Light or dark, following the app's own rule: data-theme wins, otherwise the OS preference (dark by default). */
function isLight(): boolean {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'light' : window.matchMedia('(prefers-color-scheme: light)').matches;
}

function setup(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

/** Plays the effect once; resolves when it has faded out (or immediately if the canvas has no 2D context). */
export function paperToss(canvas: HTMLCanvasElement, { count = 6, ms = 3800, bottomInset = 0 }: Options = {}): Promise<void> {
  const env = setup(canvas);
  if (!env) return Promise.resolve();
  const { ctx, W, H } = env;
  const light = isLight();
  // hard-coded paper: a warmer, darker sheet with strong creases in light so the balls read on white
  const paper = light ? '#e6dcc4' : '#d9dfe9';
  const crease = light ? '#7a6d50' : '#7d8799';
  // bin colours: the outline and the dark inside follow the app's tokens, the glassy tints stay hand-picked
  const pal = light
    ? { edge: token('--ink-3', '#6f7d9b'), body: '#9eacc8', hi: '#d3dbec', inside: '#2b3448', insideHi: '#46516a', rimC: '#e3e8f2', band: '#5d6a86' }
    : { edge: token('--ink-3', '#94a3c3'), body: '#4a5772', hi: '#7482a0', inside: token('--bg', '#0f141f'), insideHi: '#2a3348', rimC: '#8996b0', band: '#222a3c' };

  // scale with the viewport: the sample was tuned for a ~620px box
  const s = Math.max(0.8, Math.min(1.45, Math.min(W, H) / 620));
  const binW = 86 * s;
  const binH = 92 * s;
  const rx = binW / 2;
  const ry = 11 * s;
  const cx = Math.min(W - rx - 18 * s, W * 0.84);
  const cy = H - bottomInset - binH - 20 * s; // centre of the opening (rim)
  const botW = binW * 0.8;
  const botY = cy + binH;
  const floorY = botY + 6 * s; // where the stray ball bounces and rolls
  const balls: Ball[] = Array.from({ length: count }, (_, i) => ({
    i,
    start: 0.06 + i * (0.5 / count),
    dur: 0.26,
    x0: W * (0.08 + Math.random() * 0.4),
    y0: H * (0.15 + Math.random() * 0.35),
    r: (13 + Math.random() * 4) * s,
    rot: Math.random() * 6,
    last: i === count - 1,
    done: false,
  }));
  // resting spots relative to the rim centre: the bin is clear, so balls fall to the bottom and stack up
  const slots = [
    { dx: -13, dy: 92 - 18 }, { dx: 12, dy: 92 - 17 },
    { dx: -1, dy: 92 - 38 }, { dx: -16, dy: 92 - 52 }, { dx: 14, dy: 92 - 50 },
    { dx: 0, dy: 92 - 70 }, { dx: -9, dy: 4 },
  ].map((o) => ({ dx: o.dx * s, dy: o.dy * s }));
  const landed: Landed[] = [];
  const tossOut: Tossed[] = [];
  let wob = 0; // the bin rocks a little each time a ball drops in
  let frame = 0;

  const drawBall = (x: number, y: number, r: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = paper;
    ctx.strokeStyle = crease;
    ctx.lineWidth = 1.4 * s;
    ctx.beginPath();
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9) * Math.PI * 2;
      const rr = r * (0.85 + ((k * 37) % 7) / 30);
      if (k) ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      else ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.2);
    ctx.lineTo(0, r * 0.15);
    ctx.lineTo(r * 0.45, -r * 0.3);
    ctx.moveTo(-r * 0.2, r * 0.5);
    ctx.lineTo(r * 0.3, r * 0.2);
    ctx.stroke();
    ctx.restore();
  };

  // front edge of the opening → tapered sides → rounded bottom
  const binPath = () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(cx - botW / 2, botY);
    ctx.ellipse(cx, botY, botW / 2, ry * 0.8, 0, Math.PI, 0, true);
    ctx.closePath();
  };

  const draw = (p: number, dt: number) => {
    frame++;
    wob *= Math.pow(0.86, dt);
    const a = p > 0.85 ? Math.max(0, 1 - (p - 0.85) / 0.15) : 1;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = a;
    // floor shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.beginPath();
    ctx.ellipse(cx + 4 * s, botY + 4 * s, botW * 0.62, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // everything belonging to the bin rocks around its base
    ctx.save();
    ctx.translate(cx, botY);
    ctx.rotate(Math.sin(frame * 0.9) * 0.045 * wob);
    ctx.translate(-cx, -botY);
    // 1. the opening: dark inside with a soft highlight at the back
    const inner = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    inner.addColorStop(0, pal.insideHi);
    inner.addColorStop(1, pal.inside);
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - 2 * s, ry - 1.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // back half of the rim
    ctx.strokeStyle = pal.rimC;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    // the floor of the bin, seen through the clear walls
    ctx.fillStyle = pal.inside;
    ctx.globalAlpha = 0.35 * a;
    ctx.beginPath();
    ctx.ellipse(cx, botY - 2 * s, botW / 2 - 3 * s, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a;
    // 2. the balls that made it in: they drop down inside and settle onto the pile
    for (const l of landed) {
      const q = Math.min(1, (p - l.t0) / 0.1);
      const e = q * q * (3 - 2 * q) + Math.sin(q * Math.PI) * 0.06; // accelerate down, small bounce on landing
      const tx = cx + l.slot.dx;
      const ty = cy + l.slot.dy;
      drawBall(l.x0 + (tx - l.x0) * Math.min(1, e), l.y0 + (ty - l.y0) * e, l.ball.r, l.ball.rot + 9 + q * 1.4);
    }
    // 3. a clear, tinted body over the pile: light fill so the paper shows through, crisp edges, a glassy highlight
    const body = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    body.addColorStop(0, pal.edge);
    body.addColorStop(0.28, pal.hi);
    body.addColorStop(0.55, pal.body);
    body.addColorStop(1, pal.edge);
    ctx.fillStyle = body;
    ctx.globalAlpha = 0.22 * a;
    binPath();
    ctx.fill();
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = 2 * s;
    binPath();
    ctx.stroke();
    // vertical glare streaks: the cue that it's glass/plastic
    ctx.globalAlpha = 0.5 * a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.62, cy + ry + 8 * s);
    ctx.lineTo(cx - botW * 0.31, botY - 12 * s);
    ctx.stroke();
    ctx.lineWidth = 1.6 * s;
    ctx.globalAlpha = 0.35 * a;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.42, cy + ry + 12 * s);
    ctx.lineTo(cx - botW * 0.2, botY - 16 * s);
    ctx.stroke();
    // faint ribs that follow the taper
    ctx.strokeStyle = pal.edge;
    ctx.globalAlpha = 0.2 * a;
    ctx.lineWidth = 1.2 * s;
    for (const f of [-0.2, 0.15, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(cx + f * rx, cy + ry * Math.sqrt(1 - f * f) + 6 * s);
      ctx.lineTo(cx + (f * botW) / 2, botY - 4 * s);
      ctx.stroke();
    }
    // a slightly frosted base band
    ctx.globalAlpha = 0.55 * a;
    ctx.fillStyle = pal.band;
    ctx.beginPath();
    ctx.ellipse(cx, botY - 3 * s, botW / 2, ry * 0.8, 0, 0, Math.PI);
    ctx.lineTo(cx - botW / 2, botY - 10 * s);
    ctx.ellipse(cx, botY - 10 * s, botW / 2, ry * 0.8, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = a;
    // front half of the rim, drawn last so it sits over the pile
    ctx.strokeStyle = pal.rimC;
    ctx.lineWidth = 3.4 * s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    // balls still in the air (drawn over the bin)
    for (const b of balls) {
      const q = (p - b.start) / b.dur;
      if (q < 0) {
        if (q > -0.25) drawBall(b.x0, b.y0, b.r * (1 + q * 2), b.rot); // crumpling into shape
        continue;
      }
      if (b.done) continue;
      // in-bin shots aim just above the opening; the last one clips the left rim
      const tx = b.last ? cx - rx - 2 * s : cx + ((b.i % 3) - 1) * 6 * s;
      const ty = b.last ? cy - 2 * s : cy - 8 * s;
      const k = Math.min(1, q);
      const x = b.x0 + (tx - b.x0) * k;
      const y = b.y0 + (ty - b.y0) * k - Math.sin(Math.PI * k) * H * 0.28; // a lob, peaking mid-flight
      drawBall(x, y, b.r, b.rot + k * 9);
      if (k >= 1) {
        b.done = true;
        if (b.last) tossOut.push({ x, y, vx: -3.2 * s, vy: -4.5 * s, r: b.r, rot: 0 }); // clang off the rim
        else {
          landed.push({ ball: b, x0: x, y0: y, slot: slots[landed.length % slots.length], t0: p });
          wob = 1;
        }
      }
    }
    for (const t of tossOut) {
      t.vy += 0.35 * s * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.rot -= 0.25 * dt;
      if (t.y > floorY - t.r) {
        t.y = floorY - t.r;
        t.vy *= -0.35;
        t.vx *= 0.82;
      } // bounce, then roll away
      drawBall(t.x, t.y, t.r, t.rot);
    }
    ctx.globalAlpha = 1;
    if (p >= 1) ctx.clearRect(0, 0, W, H);
  };

  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      draw(p, Math.min(40, t - last) / 16.7);
      last = t;
      if (p < 1) requestAnimationFrame(tick);
      else resolve();
    };
    tick(t0);
  });
}
