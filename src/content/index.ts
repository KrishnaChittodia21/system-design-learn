import type { Company, CompanyQuestion, Topic } from '../types';
import { PHASES } from './phases';

const topicModules = import.meta.glob<{ default: Topic }>('./topics/*.ts', { eager: true });

const phaseIndex = (id: string) => PHASES.findIndex((p) => p.id === id);

export const TOPICS: Topic[] = Object.values(topicModules)
  .map((m) => m.default)
  .filter((t): t is Topic => !!t && typeof t === 'object' && !!t.id)
  .sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) || a.order - b.order);

export const TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t]));

/** exam question id → owning topic */
export const MCQ_TOPIC = new Map(TOPICS.flatMap((t) => t.test.map((q) => [q.id, t] as const)));

// companies.ts may be absent while content is being authored
const companyModules = import.meta.glob<{ COMPANIES: Company[]; COMPANY_QUESTIONS: CompanyQuestion[] }>(
  './companies.ts',
  { eager: true },
);
const companyModule = Object.values(companyModules)[0];

export const COMPANIES: Company[] = companyModule?.COMPANIES ?? [];
export const COMPANY_QUESTIONS: CompanyQuestion[] = companyModule?.COMPANY_QUESTIONS ?? [];

export { PHASES };
