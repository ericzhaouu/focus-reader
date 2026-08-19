export type SelectionStrategy =
  | 'random'
  | 'oldest-first'
  | 'domain-diversity'
  | 'time-balanced'
  | 'ai';

export const SELECTION_STRATEGIES: readonly SelectionStrategy[] = [
  'random',
  'oldest-first',
  'domain-diversity',
  'time-balanced',
  'ai',
] as const;

export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 10;

export interface Config {
  /** Bookmark folder that holds the "to read" queue. `null` until onboarding completes. */
  folderId: string | null;
  /** How many articles a batch contains. Clamped to [MIN_BATCH_SIZE, MAX_BATCH_SIZE]. */
  batchSize: number;
  strategy: SelectionStrategy;
  /** Name of the subfolder inside the queue folder that finished articles move into. */
  archiveFolderName: string;
}

export interface Candidate {
  bookmarkId: string;
  title: string;
  url: string;
  addedAt: number;
}

export type BatchItemStatus = 'unread' | 'read' | 'abandoned' | 'invalid';

export interface BatchItem extends Candidate {
  status: BatchItemStatus;
  estimatedMinutes: number;
  openedAt?: number;
  readAt?: number;
  /**
   * Archiving re-creates the bookmark so its "saved on" date reflects when it was
   * actually read, which means the id changes. Kept so reconciliation can still
   * recognise an already-archived article.
   */
  archivedId?: string;
  /** Retained for batches created by the archived focus-mode version. */
  words?: number;
}

export interface CurrentBatch {
  items: BatchItem[];
  drawnAt: number;
  /** Folder the batch was drawn from, so we can detect a config change. */
  folderId: string;
  /** Batch size in effect when the batch was drawn. */
  batchSize: number;
  /** Bumped on every draw so concurrent contexts can detect a lost update. */
  revision: number;
}

export interface Stats {
  totalRead: number;
  streakDays: number;
  /** YYYY-MM-DD of the most recent day an article was marked read. */
  lastReadDate: string | null;
  dailyCounts: Record<string, number>;
  batchesCompleted: number;
  totalAbandoned: number;
  /** Drives the "you have read the equivalent of N books" milestone. */
  totalWords: number;
  /** YYYY-MM-DD of the last reroll; the allowance resets each day. */
  lastRerollDate: string | null;
}

export interface FolderNode {
  id: string;
  title: string;
  children: FolderNode[];
}

export const DEFAULT_CONFIG: Config = {
  folderId: null,
  batchSize: 10,
  strategy: 'random',
  archiveFolderName: '已读归档',
};

export const DEFAULT_STATS: Stats = {
  totalRead: 0,
  streakDays: 0,
  lastReadDate: null,
  dailyCounts: {},
  batchesCompleted: 0,
  totalAbandoned: 0,
  totalWords: 0,
  lastRerollDate: null,
};

