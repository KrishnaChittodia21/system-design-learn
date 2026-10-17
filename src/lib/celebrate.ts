// Celebrations: a confetti burst (lazy-loaded, skipped for reduced motion) plus a short toast.
import { showToast } from './toast';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function celebrate(title: string, detail?: string) {
  showToast(title, detail);
  if (reducedMotion()) return;
  import('canvas-confetti')
    .then(({ default: confetti }) => {
      // the blueprint palette: cobalt, amber, harbour teal, pass green and drafting steel
      const colors = ['#1f4fc4', '#f2a65a', '#1590b0', '#1f9a5c', '#c4cfdf'];
      confetti({ particleCount: 90, spread: 70, startVelocity: 38, origin: { x: 0.5, y: 0.7 }, colors, disableForReducedMotion: true });
      setTimeout(() => confetti({ particleCount: 40, spread: 100, origin: { x: 0.25, y: 0.75 }, colors, disableForReducedMotion: true }), 180);
      setTimeout(() => confetti({ particleCount: 40, spread: 100, origin: { x: 0.75, y: 0.75 }, colors, disableForReducedMotion: true }), 300);
    })
    .catch(() => {
      // confetti chunk failed to load (offline): the toast is enough
    });
}
