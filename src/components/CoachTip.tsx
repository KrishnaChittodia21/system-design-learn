import { AnimatePresence, motion } from 'motion/react';
import { Lightbulb, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { dismissTip, useUiPrefs } from '../lib/uiPrefs';

/** A one-time tip on how to use a tab. Dismissals are remembered; Settings can turn all tips off. */
export function CoachTip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const prefs = useUiPrefs();
  const show = prefs.coachTips !== false && !prefs.dismissedTips?.[id];
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.aside
          className="coach-tip"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          aria-label="Tip"
        >
          <div className="coach-tip-inner">
            <span className="coach-tip-icon" aria-hidden>
              <Lightbulb size={17} />
            </span>
            <div className="coach-tip-text">
              <strong>{title}</strong> {children}
            </div>
            <button type="button" className="btn-ghost btn-xs" onClick={() => dismissTip(id)}>
              Got it
            </button>
            <button type="button" className="btn-ghost btn-xs coach-tip-x" aria-label="Dismiss tip" onClick={() => dismissTip(id)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
