import { useEffect, useRef } from 'react';
import { COMPANY_QUESTIONS, TOPICS } from '../content';
import { useProgress, type Progress } from '../lib/progress';
import { companyUnlocked, topicCompletion } from '../lib/stats';
import { celebrate } from '../lib/celebrate';
import { claimCelebration } from '../lib/uiPrefs';

const completion = (p: Progress) => new Map(TOPICS.map((t) => [t.id, topicCompletion(p, t)]));

/**
 * Watches progress and celebrates milestones as they happen: an exam passed, a topic reaching 100%,
 * a company mock completed, and (once ever) the company track unlocking. Capstones celebrate in Capstone.tsx.
 */
export function CelebrationWatcher() {
  const p = useProgress();
  const prev = useRef<{ p: Progress; done: Map<string, number> } | null>(null);

  useEffect(() => {
    const before = prev.current;
    // drafts change on every keystroke and never complete anything
    if (before && before.p.tests === p.tests && before.p.sections === p.sections && before.p.iq === p.iq && before.p.boe === p.boe && before.p.cc === p.cc && before.p.company === p.company) {
      prev.current = { p, done: before.done };
      return;
    }
    const done = completion(p);
    prev.current = { p, done };
    if (!before) {
      // first render: only the one-off unlock can fire (e.g. it happened before this feature existed)
      if (companyUnlocked(p, TOPICS).unlocked && claimCelebration('company-unlocked')) {
        celebrate('Company track unlocked!', `${COMPANY_QUESTIONS.length} real interview questions are waiting.`);
      }
      return;
    }
    const newlyPassed = TOPICS.filter((t) => p.tests[t.id]?.passedAt && !before.p.tests[t.id]?.passedAt);
    const newlyFull = TOPICS.filter((t) => done.get(t.id) === 100 && (before.done.get(t.id) ?? 0) < 100);
    const newCompany = Object.keys(p.company).filter((id) => !before.p.company[id]);

    if (companyUnlocked(p, TOPICS).unlocked && claimCelebration('company-unlocked')) {
      celebrate('Company track unlocked!', 'Every topic exam is passed. Time for real company mock interviews.');
    } else if (newlyFull.length) {
      celebrate(`${newlyFull[0].title}: 100% complete`, 'Every section, lab, question and drill done, and the exam passed.');
    } else if (newlyPassed.length) {
      celebrate(`Exam passed: ${newlyPassed[0].title}`, `Best score ${p.tests[newlyPassed[0].id].best}%. On to the next topic.`);
    } else if (newCompany.length) {
      const q = COMPANY_QUESTIONS.find((x) => x.id === newCompany[0]);
      celebrate('Mock interview completed', q ? q.title : undefined);
    }
  }, [p]);

  return null;
}
