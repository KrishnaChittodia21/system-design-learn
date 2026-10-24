// Tiny toast store: the <Toaster> in the layout renders whatever is queued here.
import { useSyncExternalStore } from 'react';

/** 'celebrate' = wins (party popper); 'gentle' = a "not yet" after a failed attempt (try-again arrow, calm colours) */
export type ToastTone = 'celebrate' | 'gentle';

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  tone?: ToastTone;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(title: string, detail?: string, ms = 3000, tone: ToastTone = 'celebrate') {
  const t: Toast = { id: nextId++, title, detail, tone };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => dismissToast(t.id), ms);
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
  );
}
