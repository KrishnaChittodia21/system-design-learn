import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PartyPopper, RotateCcw, X } from 'lucide-react';
import { dismissToast, useToasts } from '../lib/toast';

/** Bottom-right toasts (celebrations), above the mobile tab bar. Announced politely to screen readers. */
export function Toaster() {
  const toasts = useToasts();
  const reduce = useReducedMotion();
  return (
    <div className="toaster" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast glass${t.tone === 'gentle' ? ' gentle' : ''}`}
            layout={!reduce}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="toast-icon" aria-hidden>
              {t.tone === 'gentle' ? <RotateCcw size={18} /> : <PartyPopper size={18} />}
            </span>
            <div className="toast-body">
              <strong>{t.title}</strong>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
            <button type="button" className="btn-ghost toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X size={15} aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
