# Content Authoring Guide (for topic writers)

The app is a premium system-design interview prep app for a senior backend engineer
(NestJS / Node / GraphQL / microservices background) preparing for a job switch.
Every topic file is a TypeScript module that default-exports a `Topic` (see `src/types.ts` — read it first; it is the contract).

## File format

Path: `src/content/topics/<topic-id>.ts`

```ts
import type { Topic } from '../../types';

const topic: Topic = {
  id: 'cache-failures',
  phase: 'caching',
  order: 2,
  title: '...',
  // ...
};

export default topic;
```

- Use template literals for multi-line strings (markdown bodies, code). **Escape every backtick inside a template literal as \` and every `${` as `\${`.** Prefer single-quoted strings in code snippets to reduce escaping.
- Markdown fields: GFM supported (tables, bold, lists, inline code with escaped backticks). **No fenced code blocks inside markdown** — put code in `code: CodeSnippet[]`.
- ASCII diagrams go in `diagram` (monospace). Keep them ≤ 80 columns.
- IDs must be unique app-wide: prefix every id with the topic id, e.g. `cache-failures-mcq-07`, `cache-failures-iq-03`, `cache-failures-boe-2`, `cache-failures-cc-1`.

## Required volume per topic (minimum)

| Field | Count | Notes |
|---|---|---|
| sections | 7–12 | Teach simply first, then go deep. Each important section has a code snippet or diagram. |
| cheatSheet | 8–10 | One-line, dense, revision-ready bullets. |
| codeChallenges | 2 | "Improve this code": realistic naive/buggy starter → production-grade solution. |
| interviewQuestions | 7 | Real interview style, with follow-ups (2–4 each) and pitfalls. |
| envelopeQuestions | 3 | Back-of-the-envelope with explicit assumptions + step calcs + design insight. |
| test (MCQ) | 15 | Timed exam questions. |

## Teaching sections — "simple and fast, then deep"

- Open each section with a 1–2 sentence plain-English intuition (an analogy is welcome), then the precise mechanics, then trade-offs, then "in production / in interviews say this".
- Use comparison tables where options compete (e.g. Redis vs Memcached, 2PC vs Saga).
- Code: mostly TypeScript (Node/NestJS flavour, ioredis, pg, kafkajs, etc.), plus SQL, Redis Lua, YAML (k8s), nginx, protobuf, GraphQL where natural. Code must be correct, idiomatic, and runnable-looking — no pseudo-junk. 10–50 lines per snippet. Comment the non-obvious lines.
- Cite the source book where relevant via `source`, e.g. `"Alex Xu — System Design Interview Vol 2, Ch 4"` or `"Mastering API Architecture — Ch 3"`.
- Include real numbers (latency numbers, typical throughput of Redis/Kafka/Postgres, etc.) with sane ranges.

## Question quality bar — PREMIUM, NOT STRAIGHTFORWARD

Every question must be **unique** (no rephrased duplicates within the topic, and don't drift into another topic's territory — see topic map in your brief).

### MCQs (test)
- No definition-recall questions ("What does CAP stand for?"). Every MCQ is a **scenario, trade-off, debugging, or "what happens next"** question.
- Mix: ~5 `hard`, ~7 `expert`, ~3 `medium`. At least 4 use `code` (a snippet to reason about), at least 3 are multi-select (`correct` has 2–3 indexes; phrase question with "Select ALL that apply").
- 4 options (5 allowed for multi-select). Distractors must be **plausible to a mid-level engineer** — common misconceptions, half-right answers, right-answer-for-a-different-problem. Options of similar length; avoid "all of the above"/"none of the above".
- Vary the position of correct answers (the UI shuffles, but keep it balanced anyway).
- `explanation`: explain why the right answer is right AND why each tempting distractor is wrong (2–5 sentences).

### Interview questions
- Phrase exactly as a senior interviewer at a top company would (FAANG, Uber, Stripe, Atlassian, Flipkart…). Often start with a scenario: "Your p99 jumped from 80ms to 2s after…".
- `whatInterviewerLooksFor`: 3–5 signals.
- `modelAnswer`: structured markdown (headings/bullets), 150–400 words, with concrete numbers and trade-offs — what a strong senior candidate would say.
- `followUps`: 2–4 probing "what if…" follow-ups with concise answers.
- `pitfalls`: 2–4 things weak candidates say.

### Back-of-the-envelope
- Realistic prompts ("Estimate the Redis cluster size for…", "How many Kafka partitions…", "How many DB connections will 40 pods open…").
- `assumptions` explicit; `steps` each show the arithmetic (`calc`: "50M DAU × 20 req/day ÷ 86,400 ≈ 11.6K QPS; peak ×3 ≈ 35K"). Use powers of ten sensibly.
- `insight`: what design decision the number drives.

### Code challenges
- Starter code must contain realistic production bugs/smells relevant to the topic (race condition, missing timeout, cache stampede, N+1, non-idempotent handler, unbounded retry…). `task` states the goal without giving the answer. 2–3 progressive `hints`. `solution` is complete. `explanation` lists each fix.

## Validation (MANDATORY before you finish)

1. Type-check your files:
   `npx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --verbatimModuleSyntax src/content/topics/<id>.ts`
2. Structure check: `node scripts/validate-content.mjs <id> [<id> ...]`
Fix everything until both pass.

---

## Phase 12 — Miscellaneous: Interview Question Bank (additional rules)

These topics are a **question bank** over concepts the rest of the app already teaches in depth. Their value is breadth of *fresh* questions, not more long-form teaching.

**Shape of a misc topic** (`phase: 'miscellaneous'`, id prefix `misc-`):

- **sections:** exactly one short *refresher* per concept in your list, and the `heading` must start with the concept name (e.g. `'Fencing tokens — why a lock alone is not enough'`). 120–250 words each: what it is (2 lines), the mechanism, the #1 interview trap, and a snippet or diagram only where it adds clarity. These headings drive the Weak Areas section matching, so keep one concept per section.
- **interviewQuestions:** at least **2 per concept**: one *rapid-fire* (`medium`, the kind asked in the first 10 minutes; model answer 100–200 words) and one *scenario / deep-dive* (`hard` or `expert`; 200–400 words). Validator minimum for modelAnswer is still 400 characters.
- **test (MCQs):** at least **2 per concept** (so 20–30 per topic), same quality bar as the main guide (scenario-based, plausible distractors, ≥4 with code, ≥3 multi-select).
- **envelopeQuestions:** 4. **codeChallenges:** 2. **cheatSheet:** 10–12.

**Sourcing:**

- Use web search (load `WebSearch`/`WebFetch` via ToolSearch) for questions reported in real interviews in 2025–2026: Glassdoor, LeetCode Discuss, Blind, Reddit r/cscareerquestions and r/ExperiencedDevs, Hello Interview, ByteByteGo, DesignGurus, company engineering blogs.
- Rewrite every question in your own words and sharpen it to this app's quality bar. Never paste text.
- Only when a source clearly reports a question at a named company, set the interview question's `context` to the scenario and start it with that attribution, e.g. `'Reported in Uber SDE-2 loops (2025). …'`. **Never invent attributions.** Mix roughly half research-derived, half original.
- List the sites you drew on in the topic's `sources`.

**Uniqueness (hard requirement):** the app already has ~1,200 questions. Before writing questions for a concept, run
`node scripts/find-similar.mjs --keyword "<concept phrase>"` to see what exists, and pick *different angles* (a different failure mode, number, trade-off or scenario). Check doubtful drafts with `node scripts/find-similar.mjs "<draft text>"` (similarity ≥ 0.4 means rewrite).
`node scripts/validate-content.mjs <your-ids>` runs in strict mode and fails on any near-duplicate pair that involves your topics. It must pass.

---

## Follow-ups everywhere (applies to ALL topics)

Real interviews never stop at the first answer, so every item carries interviewer follow-ups (`followUps: { q, a }[]`):

| Item | Minimum | Style |
|---|---|---|
| MCQ (`test`) | 1–2 | After the candidate picks an answer, the interviewer probes deeper: "OK, and what if the traffic is 10× / the node dies mid-way / you can't change the client?" |
| Envelope question | 1–2 | "What if the input changes?" — e.g. "Peak is 10× not 3× — what breaks first?", "Storage costs must halve — which assumption do you attack?" |
| Code challenge | 2 | What the interviewer asks after you present the fix: "make it thread-safe", "how do you test this?", "now make it distributed", "what's the complexity?" |
| Interview question | 2–4 (already present) | Unchanged. |

Rules:
- A follow-up must **build on that specific question** (its scenario, numbers or code). Generic follow-ups like "any trade-offs?" are not acceptable.
- Answers (`a`) run 40–150 words: concrete, with the key mechanism or number. Markdown allowed (inline code with escaped backticks).
- Follow-ups must not give away the answer to another question in the same topic, and must not duplicate an existing interview question.
- The validator enforces: MCQ, envelope and lab ≥ 1 follow-up each (answer ≥ 40 chars); interview questions ≥ 2.

## Phase 12 — Low-Level Design (LLD) & Machine Coding (additional rules)

Phase id `lld`, topic ids prefixed `lld-`. Order of thought is always **HLD first, then LLD**:

1. **Requirements:** functional, non-functional and explicit scope, as in an HLD interview.
2. **HLD sketch:** a brief view of components and API, enough to place the LLD in context.
3. **Core entities and relationships:** nouns become classes, verbs become methods. Use composition over inheritance.
4. **Class diagram:** an ASCII `diagram` (≤ 80 cols) using UML-ish notation, e.g. `<>--` composition, `^` inheritance, `..>` dependency.
5. **Interfaces and design patterns:** say *why* each pattern is used, e.g. Strategy for pricing or eviction, State for an elevator or order, Observer for notifications, Factory for vehicles.
6. **Code:** idiomatic TypeScript classes and interfaces (Node/NestJS flavour), runnable-looking, 30–120 lines per snippet. Show the core of the design, not boilerplate.
7. **Concurrency:** be explicit about it, including double booking, locks/mutex, atomic ops, and Node's single thread vs worker_threads/multiple pods. Also note how Java would do it (`synchronized`, `ReentrantLock`, `ConcurrentHashMap`) where interviewers commonly expect it.
8. **Extensibility follow-ups:** "add a new vehicle type", "add surge pricing", "support multiple floors or buildings".
9. **Machine-coding version:** what to build in 60–90 minutes, what to stub, how to demo, and the evaluation criteria (Razorpay, Flipkart, Swiggy, PhonePe, Uber and similar run dedicated LLD/machine-coding rounds).

Code challenges in LLD topics are design refactors, e.g. a god-class → SOLID, if/else chains → Strategy, or a non-thread-safe singleton → safe.

---

## Phase 14 — Behavioural & Hiring-Manager Round (additional rules)

Phase id `behavioral`, topic ids prefixed `beh-`. The learner is a senior backend engineer (NestJS/Node/GraphQL/microservices) in India targeting product companies and FAANG India (Amazon, Google, Microsoft, Uber, Flipkart, Razorpay, Swiggy, Atlassian…).

- **sections:** teach the round: what each signal means to the interviewer (ownership, scope and impact, ambiguity, conflict, influence, mentoring, customer focus, learning from failure), how answers are scored and levelled (SDE-2 vs senior vs staff), and the frameworks (STAR/STARL, CARL). Include worked **example stories** of a backend engineer, clearly labelled as examples to adapt, never to recite. Use tables, e.g. weak vs strong phrasing, or signal → evidence that proves it.
- **codeChallenges** become **Answer Labs:** `starter` is a weak real-sounding answer (`language: 'text'`), `task` says what to fix, `hints` point to the missing signals, and `solution` is the strong rewrite (`language: 'text'`). `explanation` lists each improvement. 2 per topic, with 2 follow-ups each, i.e. the probes the interviewer would ask next.
- **interviewQuestions:** real behavioural prompts (sourced where possible). `modelAnswer` gives a structured approach plus an example STAR answer from a backend engineer's world (an incident, a migration, a disagreement over design, mentoring), with quantified results. `followUps` are the real probes ("What would you do differently?", "What did your manager say?", "How did you measure it?", "What if they still disagreed?"). `pitfalls` are what weak candidates say.
- **test (MCQs):** judgment questions, e.g. "Which answer best demonstrates Ownership?", "What is the biggest problem with this answer?", "The interviewer asks X — which follow-up response raises your level?". Use `code` with `language: 'text'` to show a candidate answer excerpt when useful. The ≥4-with-code rule is waived; ≥3 multi-select still applies.
- **envelopeQuestions:** none required.
- Never invent company-specific facts. Leadership Principles, round names and company practices must come from official pages or credible candidate reports, cited in `sources`.
