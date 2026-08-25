/**
 * Chrome-native localization with an English fallback for tests and non-extension
 * contexts. The same keys are validated against public/_locales at build time.
 */
export const FALLBACK_MESSAGES = {
  extensionName: 'Focus Reader',
  extensionDescription:
    'Turn a bookmark folder into a finite, locked reading queue: get N articles at a time, then unlock the next batch.',
  actionTitle: 'Open reading queue',
  readerPageTitle: 'Reading Queue',
  optionsPageTitle: 'Focus Reader Settings',
  commonUnknownError: 'Unknown error',
  commonSettings: 'Settings',
  commonLoading: 'Loading…',
  commonSaved: 'Saved',
  folderUnnamed: '(Unnamed folder)',
  folderEmpty: 'No bookmark folders found.',
  archiveDefaultName: 'Read Archive',

  optionsTagline: 'Finish one batch before the next.',
  optionsQueueFolderTitle: 'Reading folder',
  optionsQueueFolderDescription:
    'Articles are drawn only from direct bookmarks in this folder. Subfolders are left untouched.',
  optionsCurrentFolder: 'Current: $1',
  optionsUnreadCount: '$1 unread',
  optionsBatchTitle: 'Batch',
  optionsBatchDescription:
    'Choose the batch size and selection method. Size changes apply to the next batch without interrupting the current one.',
  optionsBatchSize: 'Articles per batch',
  optionsArticleCount: '$1 articles',
  optionsBatchLimitHint: 'Maximum 10 — beyond that, the queue becomes another bookmark folder.',
  optionsSelectionMethod: 'Selection method',
  optionsArchiveName: 'Read archive folder name',
  optionsArchiveHint:
    'Finished articles are moved into this subfolder under the reading folder. They are never deleted.',

  strategyRandomLabel: 'Random',
  strategyRandomDescription:
    'Pick completely at random — the easiest way to rediscover forgotten saves.',
  strategyOldestLabel: 'Oldest first',
  strategyOldestDescription: 'Clear the oldest saves first, including the ones waiting for years.',
  strategyDiversityLabel: 'Source diversity',
  strategyDiversityDescription: 'Rotate across domains so one batch is not dominated by one site.',
  strategyBalancedLabel: 'Balanced length',
  strategyBalancedDescription: 'Mix quick reads with longer articles worth settling into.',
  strategyAiLabel: 'AI selection',
  strategyAiDescription: 'Choose articles with AI based on your interests and context.',

  readerTagline: 'Turn bookmarks into a queue you can finish.',
  readerFromFolder: 'From $1',
  readerLoading: 'Reading your bookmarks…',
  readerSetupTitle: 'Choose a reading folder first',
  readerSetupText:
    'Pick the bookmark folder where you keep articles to read. Each time you open this page, you will see only a small batch from it.',
  readerGoToSettings: 'Open settings',
  readerFolderMissingTitle: 'Reading folder not found',
  readerFolderMissingText: 'It may have been deleted or moved. Choose another folder to continue.',
  readerChooseAgain: 'Choose again',
  readerFolderEmptyTitle: 'Your reading folder is empty',
  readerFolderEmptyText:
    'Save a few articles you want to read. Saving stays unlimited — only the number you see at once is limited.',
  readerChangeFolder: 'Choose another folder',
  readerReadyTitle: 'Ready to begin',
  readerReadyText: '$1 articles are waiting. Drawing a batch will lock $2 until it is finished.',
  readerDrawCount: 'Draw $1',
  readerReadProgress: '$1 / $2 read',
  readerAbandonedCount: '$1 abandoned',
  readerInvalidCount: '$1 unavailable',
  readerRerollAvailableTitle: 'You can reroll the whole batch once per day.',
  readerRerollStartedTitle:
    'This batch has already started. You cannot reroll it, but individual articles can be abandoned.',
  readerRerollUsedTitle: "Today's reroll is used. It returns tomorrow.",
  readerRerollAvailable: 'Reroll (1 left today)',
  readerRerollStarted: 'Started · reroll locked',
  readerRerollUsed: 'Reroll used today',
  readerCompleteTitle: 'Batch complete',
  readerCompleteMore: '$1 articles remain in the reading folder. Continue?',
  readerCompleteEmpty: 'Your reading folder is empty. Save something new when you are ready.',
  readerDrawNext: 'Draw next batch',
  readerRemaining: '$1 left. No new articles appear until this batch is complete.',

  toastMarkFailed: 'Could not mark as read: $1',
  toastBookmarkMissing: 'This bookmark is gone, so it was cleared from the queue.',
  toastBatchRead: 'Batch finished 🎉',
  toastArchived: 'Archived with today as the saved date.',
  toastAbandonFailed: 'Could not abandon: $1',
  toastBatchProcessed: 'Batch complete.',
  toastAbandoned: 'Abandoned. The bookmark was deleted.',
  toastLocked: 'Finish the current batch before drawing another.',
  toastRerollUsed: "Today's reroll is already used. Try again tomorrow.",
  toastRerollStarted:
    'This batch has started and cannot be rerolled. Abandon an individual article if needed.',
  toastNotConfigured: 'Choose a reading folder first.',
  toastFolderEmpty: 'No readable articles are waiting in this folder.',
  toastConflict: 'Another tab changed the queue. The page has been refreshed.',
  toastDrawFailed: 'Could not draw a batch.',
  toastRerolled: "New batch drawn. Today's reroll is now used.",

  articleAddedUnknown: 'Saved date unknown',
  articleAddedToday: 'Saved today',
  articleAddedYesterday: 'Saved yesterday',
  articleAddedDays: 'Saved $1 days ago',
  articleAddedMonths: 'Saved $1 months ago',
  articleAddedOn: 'Saved on $1',
  articleUnknownSource: 'Unknown source',
  articleEstimatedMinutes: 'About $1 min',
  articleInvalid: 'No longer in the reading folder',
  articleAbandoned: 'Abandoned · bookmark deleted',
  articleOpen: 'Open',
  articleOpenAgain: 'Open again',
  articleAbandon: 'Abandon',
  articleConfirmAbandon: 'Confirm abandon?',
  articleAbandonTitle: 'Permanently delete this bookmark. This cannot be undone.',
  articleMarkRead: 'Read',

  arcadeCleared: 'CLEARED',
  arcadeScore: 'SCORE',
  arcadeStage: 'STAGE $1',
  arcadeLoopStage: 'LOOP $1 · STAGE $2',
  arcadeClearedLoops: 'Cleared War and Peace $1×',
  arcadeClearedBook: 'Cleared $1',
  arcadeNoBook: 'No stage cleared yet',
  arcadeReadMoreUnlock: 'Read $1 more to unlock $2',
  arcadeReadMoreLoop: 'Read $1 more to start the next loop',
  arcadeStart: '▶ Finish your first article to start',
  arcadeBookTooltip: '$1 · $2$3',
  arcadeBookClearedSuffix: ' · cleared',
  statTotalRead: 'Articles read',
  statStreak: 'Reading streak',
  statBatches: 'Batches complete',
  statAbandoned: 'Abandoned',
  wordsCount: '$1 words',
  wordsCountCompact: '$1k words',

  milestoneLongReport: 'a long-form article',
  milestoneMetamorphosis: 'The Metamorphosis',
  milestoneLittlePrince: 'The Little Prince',
  milestoneOldManSea: 'The Old Man and the Sea',
  milestoneAnimalFarm: 'Animal Farm',
  milestoneGreatGatsby: 'The Great Gatsby',
  milestoneStranger: 'The Stranger',
  milestoneToLive: 'To Live',
  milestonePridePrejudice: 'Pride and Prejudice',
  milestoneFortressBesieged: 'Fortress Besieged',
  milestoneHundredYears: 'One Hundred Years of Solitude',
  milestoneThreeBody: 'The Three-Body Problem',
  milestoneSapiens: 'Sapiens',
  milestoneToLiveFive: 'To Live × 5',
  milestoneRedChamber: 'Dream of the Red Chamber',
  milestoneOrdinaryWorld: 'Ordinary World',
  milestoneWarPeace: 'War and Peace',
} as const;

export type MessageKey = keyof typeof FALLBACK_MESSAGES;

function substitute(message: string, values: readonly (string | number)[]): string {
  return values.reduce<string>(
    (result, value, index) => result.replaceAll(`$${index + 1}`, String(value)),
    message,
  );
}

export function t(
  key: MessageKey,
  values: readonly (string | number)[] = [],
): string {
  const api = globalThis.chrome?.i18n;
  if (api?.getMessage) {
    const localized = api.getMessage(key, values.map(String));
    if (localized) return localized;
  }
  return substitute(FALLBACK_MESSAGES[key], values);
}

export function uiLocale(): string {
  return globalThis.chrome?.i18n?.getUILanguage?.() || 'en';
}

export function setDocumentLocale(titleKey: MessageKey): void {
  document.documentElement.lang = uiLocale();
  document.title = t(titleKey);
}
