// The random session UUID assigns an order independently of experimental condition.
// Keep this mapping stable so refreshing/reopening a session preserves its order.
const permutations = [
  ['ai_literacy', 'metacognition', 'trust'],
  ['ai_literacy', 'trust', 'metacognition'],
  ['metacognition', 'ai_literacy', 'trust'],
  ['metacognition', 'trust', 'ai_literacy'],
  ['trust', 'ai_literacy', 'metacognition'],
  ['trust', 'metacognition', 'ai_literacy'],
];

export function orderSurveyPages<T extends {id: string}>(pages: readonly T[], sessionId: string): T[] {
  let hash = 2166136261;
  for (const character of `survey-order-v1:${sessionId}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  const order = permutations[hash % permutations.length];
  const blocks = order.map(id => pages.find(page => page.id === id));
  if (blocks.some(block => !block)) throw new Error('Missing randomized survey block');
  let index = 0;
  return pages.map(page => order.includes(page.id) ? blocks[index++]! : page);
}
