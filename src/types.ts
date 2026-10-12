// Content contract for every topic file in src/content/topics/*.ts
// Markdown fields support GitHub-flavored markdown (tables, lists, bold, inline code).
// Do NOT put fenced code blocks inside markdown — use the `code` arrays instead.

export type PhaseId =
  | 'fundamentals'
  | 'networking'
  | 'caching'
  | 'databases'
  | 'distributed'
  | 'messaging'
  | 'reliability'
  | 'apis-security'
  | 'platform'
  | 'production'
  | 'designs'
  | 'lld'
  | 'miscellaneous'
  | 'behavioral';

export type Difficulty = 'medium' | 'hard' | 'expert';

export interface CodeSnippet {
  /** prism language id: typescript | javascript | sql | bash | yaml | json | lua | python | go | java | graphql | protobuf | nginx | text */
  language: string;
  title?: string;
  code: string;
}

export interface Section {
  heading: string;
  /** markdown */
  body: string;
  code?: CodeSnippet[];
  /** optional ASCII diagram rendered in monospace */
  diagram?: string;
  keyPoints?: string[];
  /** e.g. "Alex Xu Vol 2 — Ch 4 Distributed Message Queue" */
  source?: string;
}

/** "Improve this code" exercise: naive/buggy starter → production-grade solution */
export interface CodeChallenge {
  id: string;
  title: string;
  context: string;
  task: string;
  starter: CodeSnippet;
  hints: string[];
  solution: CodeSnippet;
  /** markdown: why the solution is better */
  explanation: string;
  /** what the interviewer asks after you present the solution */
  followUps?: FollowUp[];
}

export interface FollowUp {
  q: string;
  a: string;
}

export interface InterviewQuestion {
  id: string;
  difficulty: Difficulty;
  question: string;
  /** optional scenario framing the interviewer gives */
  context?: string;
  whatInterviewerLooksFor: string[];
  /** markdown */
  modelAnswer: string;
  followUps: FollowUp[];
  pitfalls: string[];
}

export interface EnvelopeStep {
  label: string;
  calc: string;
}

export interface EnvelopeQuestion {
  id: string;
  question: string;
  assumptions: string[];
  steps: EnvelopeStep[];
  answer: string;
  /** the design implication the numbers reveal */
  insight: string;
  /** "now what if…" probes on the estimate */
  followUps?: FollowUp[];
}

export interface MCQ {
  id: string;
  difficulty: Difficulty;
  question: string;
  code?: CodeSnippet;
  options: string[];
  /** indexes into options; more than one => "select all that apply" */
  correct: number[];
  explanation: string;
  /** what the interviewer asks next once you have answered */
  followUps?: FollowUp[];
}

export interface Topic {
  id: string;
  phase: PhaseId;
  /** ordering within the phase, 1-based */
  order: number;
  title: string;
  subtitle: string;
  estimatedMinutes: number;
  sources: string[];
  tags: string[];
  /** 6–10 crisp bullets for last-minute revision */
  cheatSheet: string[];
  sections: Section[];
  codeChallenges: CodeChallenge[];
  interviewQuestions: InterviewQuestion[];
  envelopeQuestions: EnvelopeQuestion[];
  test: MCQ[];
}

// ---------- Company track ----------

export interface DeepDive {
  topic: string;
  /** markdown */
  discussion: string;
}

export interface CompanyQuestion {
  id: string;
  company: string;
  title: string;
  frequency: 'very-high' | 'high' | 'medium';
  level: string;
  prompt: string;
  clarifyingQuestions: string[];
  functional: string[];
  nonFunctional: string[];
  estimation: EnvelopeStep[];
  /** markdown */
  highLevelDesign: string;
  diagram?: string;
  deepDives: DeepDive[];
  tradeoffs: string[];
  followUps: FollowUp[];
  /** topic ids from src/content/topics */
  relatedTopics: string[];
}

export interface Company {
  id: string;
  name: string;
  focus: string;
  interviewStyle: string;
}
