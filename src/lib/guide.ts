// App-wide "guide" UI state: the welcome tour and the command palette can be opened from anywhere.
import { useSyncExternalStore } from 'react';

interface GuideState {
  tour: boolean;
  palette: boolean;
}

let state: GuideState = { tour: false, palette: false };
const listeners = new Set<() => void>();

function set(patch: Partial<GuideState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const openTour = () => set({ tour: true, palette: false });
export const closeTour = () => set({ tour: false });
export const openPalette = () => set({ palette: true });
export const closePalette = () => set({ palette: false });

export function useGuide(): GuideState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
