// Commiseration for a failed attempt: a gentle toast plus the "paper toss" effect (lazy-loaded, skipped for reduced motion).
import { showToast } from './toast';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Height to keep clear at the bottom: the mobile tab bar, and the toast stack (it sits bottom-right, over the bin). */
function bottomInset(): number {
  const vh = window.innerHeight;
  let inset = 0;
  const bar = document.querySelector<HTMLElement>('.nb-tabbar');
  if (bar && bar.offsetParent) inset = Math.max(0, vh - bar.getBoundingClientRect().top);
  const toaster = document.querySelector<HTMLElement>('.toaster');
  if (toaster) {
    const r = toaster.getBoundingClientRect();
    // the toaster grows upward from its bottom edge; allow for one toast even if it hasn't painted yet
    inset = Math.max(inset, vh - Math.min(r.top, r.bottom - 96) + 8);
  }
  return inset;
}

export function commiserate(title: string, detail?: string) {
  showToast(title, detail, 5000, 'gentle');
  if (reducedMotion()) return;
  import('./paperToss')
    .then(({ paperToss }) => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      // full viewport, click-through; below toasts (85) and modals (90)
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:80';
      document.body.appendChild(canvas);
      // measure after a frame so the toast that was just queued has laid out
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        .then(() => paperToss(canvas, { bottomInset: bottomInset() }))
        .finally(() => canvas.remove());
    })
    .catch(() => {
      // effect chunk failed to load (offline): the toast is enough
    });
}
