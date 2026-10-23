import type { BaseFrame } from '../../core';

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'muted' | 'mag';

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  tone: Tone;
}

export interface FlowFrame extends BaseFrame {
  active: Record<string, Tone>;
  edges: FlowEdge[];
}
