// Frames for the architecture-evolution stepper: for each era, first the architecture as it was
// changed (new boxes highlighted), then the pressure that built up on it (hot boxes), which is
// what forced the next era. Ends with the story's lesson.
import type { BaseFrame } from '../../core';
import { STORIES, type Era, type Story } from './stories';

export interface Params {
  story: string;
}

export interface Frame extends BaseFrame {
  era: number;
  mode: 'era' | 'pressure' | 'lesson';
  newIds: string[];
  hot: string[];
}

export const storyById = (id: string): Story => STORIES.find((s) => s.id === id) ?? STORIES[0];

const idsOf = (e: Era) => [...e.rows.flat().map((b) => b.id), ...(e.side ? [e.side.id] : [])];

export function simulate({ story }: Params): Frame[] {
  const s = storyById(story);
  const frames: Frame[] = [];
  s.eras.forEach((e, i) => {
    const prev = i > 0 ? new Set(idsOf(s.eras[i - 1])) : new Set<string>();
    const newIds = i === 0 ? [] : idsOf(e).filter((id) => !prev.has(id) && id !== 'client');
    frames.push({
      era: i,
      mode: 'era',
      newIds,
      hot: [],
      caption: `${s.label}, era ${i + 1}/${s.eras.length} (${e.years}): ${e.title}. ${e.change}`,
      predict: i === 0 ? `This works well at first. What do you expect to break as the company grows?` : undefined,
    });
    if (e.pressure)
      frames.push({
        era: i,
        mode: 'pressure',
        newIds: [],
        hot: e.pressure.hot,
        caption: `Pressure on "${e.title}": ${e.pressure.text}`,
        predict: `What would you change, and what new problem might that change create?`,
      });
  });
  frames.push({
    era: s.eras.length - 1,
    mode: 'lesson',
    newIds: [],
    hot: [],
    caption: `Lesson (${s.sections}): ${s.lesson}`,
  });
  return frames;
}
