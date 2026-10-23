// Pure simulations for the platform designs (no React here). Each design lives in its own file;
// this module re-exports them for the views and the unit checks.
export type { Tone, FlowEdge, FlowFrame } from './types';
export * from './simBroker';
export * from './simCi';
export * from './simChess';
export * from './simCal';
export * from './simRag';
