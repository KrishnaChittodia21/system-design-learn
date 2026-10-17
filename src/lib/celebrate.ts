// Celebrations: a confetti burst (lazy-loaded, skipped for reduced motion) plus a short toast.
import { showToast } from './toast';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The Nebula hues from the live theme tokens (confetti needs plain hex/rgb colours). */
function nebulaColors(): string[] | undefined {
  const css = getComputedStyle(document.documentElement);
  const colors = ['--blue', '--cyan', '--amber', '--mag', '--green']
    .map((v) => css.getPropertyValue(v).trim())
    .filter((c) => c && !c.includes('('));
  return colors.length ? colors : undefined;
}

export function celebrate(title: string, detail?: string) {
  showToast(title, detail, 5000);
  if (reducedMotion()) return;
  import('canvas-confetti')
    .then(({ default: confetti }) => {
      const colors = nebulaColors();
      confetti({ particleCount: 90, spread: 70, startVelocity: 38, origin: { x: 0.5, y: 0.7 }, colors, disableForReducedMotion: true });
      setTimeout(() => confetti({ particleCount: 40, spread: 100, origin: { x: 0.25, y: 0.75 }, colors, disableForReducedMotion: true }), 180);
      setTimeout(() => confetti({ particleCount: 40, spread: 100, origin: { x: 0.75, y: 0.75 }, colors, disableForReducedMotion: true }), 300);
    })
    .catch(() => {
      // confetti chunk failed to load (offline): the toast is enough
    });
}
