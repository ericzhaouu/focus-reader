/**
 * Turns an abstract word count into something you can picture.
 *
 * Borrowed from the running apps that convert kilometres into bowls of rice: a raw
 * number is forgettable, "you have read a novel's worth" is not. Word counts are
 * approximate — the point is recognisability, not bibliographic precision.
 */
import { t, uiLocale, type MessageKey } from './i18n';

export interface Milestone {
  id: MilestoneId;
  titleKey: MessageKey;
  words: number;
}

export type MilestoneId =
  | 'long-report'
  | 'metamorphosis'
  | 'little-prince'
  | 'old-man-sea'
  | 'animal-farm'
  | 'great-gatsby'
  | 'stranger'
  | 'to-live'
  | 'pride-prejudice'
  | 'fortress-besieged'
  | 'hundred-years'
  | 'three-body'
  | 'sapiens'
  | 'to-live-five'
  | 'red-chamber'
  | 'ordinary-world'
  | 'war-peace';

export const MILESTONES: readonly Milestone[] = [
  { id: 'long-report', titleKey: 'milestoneLongReport', words: 8_000 },
  { id: 'metamorphosis', titleKey: 'milestoneMetamorphosis', words: 20_000 },
  { id: 'little-prince', titleKey: 'milestoneLittlePrince', words: 27_000 },
  { id: 'old-man-sea', titleKey: 'milestoneOldManSea', words: 50_000 },
  { id: 'animal-farm', titleKey: 'milestoneAnimalFarm', words: 60_000 },
  { id: 'great-gatsby', titleKey: 'milestoneGreatGatsby', words: 90_000 },
  { id: 'stranger', titleKey: 'milestoneStranger', words: 110_000 },
  { id: 'to-live', titleKey: 'milestoneToLive', words: 130_000 },
  { id: 'pride-prejudice', titleKey: 'milestonePridePrejudice', words: 180_000 },
  { id: 'fortress-besieged', titleKey: 'milestoneFortressBesieged', words: 240_000 },
  { id: 'hundred-years', titleKey: 'milestoneHundredYears', words: 270_000 },
  { id: 'three-body', titleKey: 'milestoneThreeBody', words: 300_000 },
  { id: 'sapiens', titleKey: 'milestoneSapiens', words: 380_000 },
  { id: 'to-live-five', titleKey: 'milestoneToLiveFive', words: 650_000 },
  { id: 'red-chamber', titleKey: 'milestoneRedChamber', words: 730_000 },
  { id: 'ordinary-world', titleKey: 'milestoneOrdinaryWorld', words: 1_040_000 },
  { id: 'war-peace', titleKey: 'milestoneWarPeace', words: 1_300_000 },
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
  const locale = uiLocale();
  const compact = (value: number): string =>
    value >= 100 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
  if (locale.toLowerCase().startsWith('zh')) {
    if (words < 10_000) {
      return t('wordsCount', [Math.round(words).toLocaleString(locale)]);
    }
    const wan = words / 10_000;
    return t('wordsCountCompact', [compact(wan)]);
  }
  if (words < 1_000) return t('wordsCount', [Math.round(words).toLocaleString(locale)]);
  const thousands = words / 1_000;
  return t('wordsCountCompact', [compact(thousands)]);
}

export function milestoneTitle(milestone: Milestone): string {
  return t(milestone.titleKey);
}

/** Milestones already passed, oldest first — the shelf of cleared stages. */
export function clearedMilestones(totalWords: number): Milestone[] {
  const words = Math.max(0, Math.floor(totalWords));
  return MILESTONES.filter((milestone) => words >= milestone.words);
}

/** 1-based index of the stage in progress, for the arcade HUD. */
export function stageNumber(totalWords: number): number {
  return clearedMilestones(totalWords).length + 1;
}

/** Zero-padded arcade score, e.g. `0118400`. */
export function formatScore(words: number): string {
  return String(Math.max(0, Math.floor(words))).padStart(7, '0');
}

/**
 * Converts the source-page reading-time estimate into words for arcade progress.
 * Blends the CJK and Latin reading speeds previously used by the parser.
 */
export function wordsFromMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes * 320));
}
