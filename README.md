# System Design Interview Prep

A React app for learning system design topic by topic. Each topic has lessons with code, an editable "improve this code" lab, interview questions, back-of-the-envelope drills and a timed exam. After you pass every exam, a company-specific question track unlocks.

Content is based on *System Design Interview Vol 2* (Alex Xu), *Mastering API Architecture*, and a senior backend interview syllabus. The company questions came from web research.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # static build in dist/ (hash routing, works on any static host)
    npm run validate   # checks every topic file against the content rules

## What's inside

- **47 topics in 11 phases:** Fundamentals → Networking → Caching → Databases → Distributed Systems → Messaging → Reliability → APIs & Security → Platform → Production Problem→Solution → Complete Designs.
- **Every topic has:**
  - Learn: 8–15 sections with code snippets and diagrams
  - Code Lab: 2 challenges where you edit buggy code, get progressive hints, then compare with the reference solution
  - 7 interview questions: draft your answer, then reveal the model answer, the follow-ups and the pitfalls, and rate yourself
  - 3+ back-of-the-envelope drills, revealed step by step
  - A cheat sheet
  - A 15-question timed exam: you set the time, questions and options are shuffled, and multi-select questions need an exact match
- **Company track:** 48 questions from 24 companies (FAANG, Stripe, Uber, Atlassian, Flipkart, Razorpay, Zepto…), each with a mock-interview timer and 7 stages you reveal one at a time. It unlocks when every topic exam is passed at the pass mark (default 70%, adjustable in Settings).

## Finding your way

- **Your next step:** the dashboard always shows one action to take next (the next unread section, lab, question set, drill or exam), plus "continue where you left off" and your weakest section.
- **Study path:** each topic page has a stepper: Learn → Code Lab → Interview Qs → Back-of-Envelope → Exam (→ Capstone). Each tab ends with a "Next up" button.
- **Contents** (`#/contents`): every phase, topic, section, animation and practice page on one searchable page.
- **Search:** press `Ctrl K` / `⌘ K` to jump to any topic, section, company question or capstone.
- **Guide:** a welcome tour opens on the first visit. Reopen it with the Guide button or the `?` key. Coach tips can be turned off in Settings.

Progress is saved in your browser's localStorage. You can reset it from Settings.

## Adding content

Topic files live in `src/content/topics/*.ts` and must match `src/types.ts`. See `CONTENT_GUIDE.md` for the quality rules, then run `npm run validate`.
