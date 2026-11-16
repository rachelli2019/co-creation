export type WritingPhase = 'rough' | 'final';
export type AIAccess = 'rough' | 'final' | 'both' | 'neither';
export const PHASE_SECONDS = 10 * 60;
export function parseAIAccess(value: string | undefined): AIAccess {
  if (!value) return 'both';
  if (['rough', 'final', 'both', 'neither'].includes(value)) return value as AIAccess;
  throw new Error('AI access must be rough, final, both, or neither');
}
export function aiEnabled(group: string, access: AIAccess, phase: WritingPhase) {
  return group.startsWith('AI') && (access === 'both' || access === phase);
}
export const accessLabels: Record<AIAccess, string> = {
  rough: 'Rough draft only', final: 'Final draft only', both: 'Both drafts', neither: 'Neither draft',
};
