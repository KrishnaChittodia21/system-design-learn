import { AnimatePresence, motion } from 'motion/react';
import { PartyPopper, X } from 'lucide-react';
import { dismissToast, useToasts } from '../lib/toast';

/** Bottom-right toasts (celebrations). Announced politely to screen readers. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="toaster" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <PartyPopper className="toast-icon" size={20} aria-hidden />
            <div className="toast-body">
              <strong>{t.title}</strong>
              {t.detail && <div className="small muted">{t.detail}</div>}
            </div>
            <button type="button" className="btn-ghost btn-icon" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X size={16} aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
