// Pure data + logic for the Leadership-Principle story-bank coverage grid. The 16 LPs and the
// six example stories with their primary/secondary LPs come straight from the topic's mapping
// table. coverage() counts how many stories back each LP: 0 = gap, 1 = no backup for
// "can you give me another example?", 2+ = covered. No React here.
import type { BaseFrame } from '../../core';

export const LPS = [
  'Customer Obsession',
  'Ownership',
  'Invent and Simplify',
  'Are Right, A Lot',
  'Learn and Be Curious',
  'Hire and Develop the Best',
  'Insist on the Highest Standards',
  'Think Big',
  'Bias for Action',
  'Frugality',
  'Earn Trust',
  'Dive Deep',
  'Have Backbone; Disagree and Commit',
  'Deliver Results',
  'Strive to be Earth’s Best Employer',
  'Success and Scale Bring Broad Responsibility',
];

export type Tag = 0 | 1 | 2; // none, secondary, primary

export interface Story {
  id: string;
  short: string;
  title: string;
  primary: number[]; // LP numbers (1-based)
  secondary: number[];
}

export const STORIES: Story[] = [
  { id: 'migration', short: 'Aurora migration', title: 'Postgres to Aurora migration with dual writes', primary: [14, 12], secondary: [2, 7] },
  { id: 'outage', short: 'Sev-1 outage', title: 'Sev-1 payment outage you caused and fixed', primary: [11, 2], secondary: [9, 7] },
  { id: 'dispute', short: 'API dispute', title: 'API design dispute with a principal engineer', primary: [13], secondary: [4, 11] },
  { id: 'cost', short: 'Cost cut', title: 'Notification platform cost cut (₹14L to ₹6L/month)', primary: [10, 3], secondary: [8, 1] },
  { id: 'no', short: 'Saying no', title: 'Saying no to a client team’s API request', primary: [1], secondary: [4, 3] },
  { id: 'oncall', short: 'On-call + mentoring', title: 'On-call health + mentoring two SDE-1s', primary: [15, 6], secondary: [5, 16] },
];

export type Tags = Record<string, Tag[]>; // story id -> 16 tags

export function defaultTags(): Tags {
  return Object.fromEntries(
    STORIES.map((s) => [s.id, LPS.map((_, i) => (s.primary.includes(i + 1) ? 2 : s.secondary.includes(i + 1) ? 1 : 0) as Tag)]),
  );
}

export function coverage(tags: Tags, inBank: string[]) {
  const counts = LPS.map((_, i) => inBank.filter((id) => tags[id][i] > 0).length);
  const primaries = LPS.map((_, i) => inBank.filter((id) => tags[id][i] === 2).length);
  return {
    counts,
    primaries,
    gaps: counts.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0),
    thin: counts.map((c, i) => (c === 1 ? i : -1)).filter((i) => i >= 0),
    solid: counts.filter((c) => c >= 2).length,
  };
}

export const cycle = (t: Tag): Tag => ((t + 1) % 3) as Tag;

export interface Frame extends BaseFrame {
  /** number of stories in the bank at this step */
  n: number;
}

/** step k = the first k stories of the table are in the bank */
export const STEPS: Frame[] = Array.from({ length: STORIES.length + 1 }, (_, n) => ({ n, caption: '' }));
