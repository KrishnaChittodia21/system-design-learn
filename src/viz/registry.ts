import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { VizMeta } from './core';

// Each visualisation lives in src/viz/widgets/<id>/ with:
//   meta.ts   → export const meta: VizMeta   (small; loaded eagerly to know placements)
//   index.tsx → export default function Widget()   (lazy-loaded only when its section is opened)
const metas = import.meta.glob<VizMeta>('./widgets/*/meta.ts', { eager: true, import: 'meta' });
const widgets = import.meta.glob<{ default: ComponentType }>('./widgets/*/index.tsx');

export const VIZ: { meta: VizMeta; Component: LazyExoticComponent<ComponentType> }[] = Object.entries(metas).flatMap(
  ([path, meta]) => {
    const loader = widgets[path.replace('/meta.ts', '/index.tsx')];
    return loader ? [{ meta, Component: lazy(loader) }] : [];
  },
);

/** Visualisations placed on a given section of a topic. */
export function vizForSection(topicId: string, heading: string) {
  return VIZ.filter((v) => v.meta.placements.some((p) => p.topic === topicId && heading.startsWith(p.heading)));
}
