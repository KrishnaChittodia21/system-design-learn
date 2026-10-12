import type { PhaseId } from '../types';

export interface Phase {
  id: PhaseId;
  number: number;
  title: string;
  blurb: string;
}

export const PHASES: Phase[] = [
  { id: 'fundamentals', number: 1, title: 'Fundamentals', blurb: 'Requirements, estimation and the vocabulary of scale.' },
  { id: 'networking', number: 2, title: 'Networking & Traffic', blurb: 'Protocols, real-time transports, gateways, mesh and load balancing.' },
  { id: 'caching', number: 3, title: 'Caching & CDN', blurb: 'Cache patterns, cache failure modes and global edge delivery.' },
  { id: 'databases', number: 4, title: 'Databases', blurb: 'Modeling, indexing, pooling, replication, sharding and DB firefighting.' },
  { id: 'distributed', number: 5, title: 'Distributed Systems', blurb: 'Consistency, consensus, distributed transactions and concurrency.' },
  { id: 'messaging', number: 6, title: 'Messaging & Data Pipelines', blurb: 'Queues, Kafka, async failure modes and stream processing.' },
  { id: 'reliability', number: 7, title: 'Reliability & Resilience', blurb: 'Resilience patterns, disaster recovery and rate limiting.' },
  { id: 'apis-security', number: 8, title: 'APIs & Security', blurb: 'API design, evolution, testing, OAuth2/JWT and application security.' },
  { id: 'platform', number: 9, title: 'Platform & Operations', blurb: 'Search, observability, microservices, deployment and object storage.' },
  { id: 'production', number: 10, title: 'Production Problem → Solution', blurb: 'Senior-level incident scenarios and the architecture that fixes them.' },
  { id: 'designs', number: 11, title: 'Complete System Designs', blurb: 'End-to-end case studies from classic to advanced.' },
  {
    id: 'lld',
    number: 12,
    title: 'Low-Level Design (LLD) & Machine Coding',
    blurb: 'From HLD to classes: OOP, SOLID, patterns, concurrency, the LRU cache and classic LLD rounds.',
  },
  {
    id: 'miscellaneous',
    number: 13,
    title: 'Miscellaneous: Interview Question Bank',
    blurb: 'Rapid-fire and deep-dive questions on the Tier 1 and Tier 2 concepts interviewers ask most in 2026.',
  },
  {
    id: 'behavioral',
    number: 14,
    title: 'Behavioural & Hiring-Manager Round',
    blurb: 'STAR stories, Amazon Leadership Principles, bar raiser and senior scenarios: the rounds that decide the level and the offer.',
  },
];
