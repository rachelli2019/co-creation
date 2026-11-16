export const previewBrainstorm = {
  quick_ideas: 'A beach trip, a lost family locket, and an unexpected invitation.',
  main_char: 'An unnamed narrator drives their friends Sam, Marcus, and Lena to the beach. Lena is preparing to study abroad.',
  setting: 'One summer day at a beach with dunes, a jetty, and a nearby pier.',
  conflict: 'Lena hopes to find a small locket her grandmother lost years ago. The search becomes a way to confront leaving her friends behind.',
  resolution: 'The friends do not find the locket, but choose to make one more memory together by following a mysterious invitation.',
  plot: 'Drive to the beach; swim and relax; Sam plays guitar and Marcus brings an inflatable flamingo; search for the locket; Lena reveals her plans; discover an invitation and decide to investigate.',
};
export function outlineText(value: string) {
  try {
    const outline = JSON.parse(value);
    const labels: Record<string, string> = {quick_ideas: 'Quick ideas', main_char: 'Main character', setting: 'Setting', conflict: 'Conflict', resolution: 'Resolution', plot: 'Plot'};
    return Object.entries(labels).filter(([key]) => outline[key]).map(([key, label]) => `${label}: ${outline[key]}`).join('\n');
  } catch { return value; }
}
