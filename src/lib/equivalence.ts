/**
 * Turns an abstract word count into something you can picture.
 *
 * Borrowed from the running apps that convert kilometres into bowls of rice: a raw
 * number is forgettable, "you have read a novel's worth" is not. Word counts are
 * approximate — the point is recognisability, not bibliographic precision.
 */
export interface Milestone {
  title: string;
  words: number;
}

export const MILESTONES: readonly Milestone[] = [
  { title: '一篇长报道', words: 8_000 },
  { title: '《变形记》', words: 20_000 },
  { title: '《小王子》', words: 27_000 },
  { title: '《老人与海》', words: 50_000 },
  { title: '《动物庄园》', words: 60_000 },
  { title: '《了不起的盖茨比》', words: 90_000 },
  { title: '《局外人》', words: 110_000 },
  { title: '《活着》', words: 130_000 },
  { title: '《傲慢与偏见》', words: 180_000 },
  { title: '《围城》', words: 240_000 },
  { title: '《百年孤独》', words: 270_000 },
  { title: '《三体》', words: 300_000 },
  { title: '《人类简史》', words: 380_000 },
  { title: '《活着》× 5', words: 650_000 },
  { title: '《红楼梦》', words: 730_000 },
  { title: '《平凡的世界》', words: 1_040_000 },
  { title: '《战争与和平》', words: 1_300_000 },
] as const;

export interface EquivalenceProgress {
  /** Largest milestone already cleared, or null before the first one. */
  achieved: Milestone | null;
  /** The one being worked towards, or null once everything is cleared. */
  next: Milestone | null;
  /** 0..1 progress from `achieved` (or zero) to `next`. */
  ratio: number;
  /** Words still needed to reach `next`. */
  remaining: number;
  /** How many times the whole ladder has been completed. */
  loops: number;
}

export function equivalenceFor(totalWords: number): EquivalenceProgress {
  const words = Math.max(0, Math.floor(totalWords));
  const top = MILESTONES[MILESTONES.length - 1] as Milestone;

  if (words >= top.words) {
    // Past the ladder, keep counting in whole "War and Peace" units.
    const loops = Math.floor(words / top.words);
    const withinLoop = words - loops * top.words;
    return {
      achieved: top,
      next: null,
      ratio: withinLoop / top.words,
      remaining: (loops + 1) * top.words - words,
      loops,
    };
  }

  let achieved: Milestone | null = null;
  let next: Milestone = MILESTONES[0] as Milestone;
  for (const milestone of MILESTONES) {
    if (words >= milestone.words) achieved = milestone;
    else {
      next = milestone;
      break;
    }
  }

  const floor = achieved?.words ?? 0;
  const span = next.words - floor;
  return {
    achieved,
    next,
    ratio: span > 0 ? (words - floor) / span : 0,
    remaining: next.words - words,
    loops: 0,
  };
}

/** `13500` -> `1.4 万字`, `800` -> `800 字` */
export function formatWords(words: number): string {
  if (words < 10_000) return `${Math.round(words).toLocaleString('zh-CN')} 字`;
  const wan = words / 10_000;
  return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万字`;
}

/**
 * Fallback when an article was never opened in focus mode and so was never parsed.
 * Blends the CJK and Latin reading speeds used by `minutesFromText`.
 */
export function wordsFromMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes * 320));
}
