import type { CapstoneProject } from '../types';

// Each capstone lives in projects/<id>/ with a project.json manifest, starter code in src/,
// a reference solution in solution/ and the judging tests in test/.
const manifests = import.meta.glob<CapstoneProject>('../../projects/*/project.json', { eager: true, import: 'default' });

export const PROJECTS: CapstoneProject[] = Object.values(manifests).sort((a, b) => a.title.localeCompare(b.title));

export function projectsForTopic(topicId: string): CapstoneProject[] {
  return PROJECTS.filter((p) => p.topics.includes(topicId));
}
