import {
  archiveBookmark,
  findArchiveFolder,
  findArchivedByUrl,
  folderExists,
  getNode,
  listCandidates,
  removeBookmark,
} from './bookmarks';
import { estimateMinutes, loadLearnedPriors } from './estimate';
import { wordsFromMinutes } from './equivalence';
import { pickBatch } from './selection';
import {
  getConfig,
  getCurrentBatch,
  getStats,
  setCurrentBatch,
  setStats,
} from './storage';
import type { BatchItem, Config, CurrentBatch, Stats } from './types';

export type QueueState =
  | { kind: 'needs-setup' }
  | { kind: 'folder-missing'; config: Config }
  | { kind: 'empty-folder'; config: Config }
  | { kind: 'no-batch'; config: Config; availableCount: number }
  | {
      kind: 'batch';
      config: Config;
      batch: CurrentBatch;
      unreadCount: number;
      readCount: number;
      abandonedCount: number;
      invalidCount: number;
      /** Articles still sitting in the queue folder, excluding the current batch. */
      availableCount: number;
      /** A batch is complete — and therefore unlocked — once nothing is unread. */
      complete: boolean;
      canReroll: boolean;
      /** Why the reroll button is unavailable, so the UI can explain itself. */
      rerollBlockedBy: 'none' | 'used-today' | 'already-started';
    };

function todayKey(now = Date.now()): string {
  const date = new Date(now);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayKeyOffset(days: number, now = Date.now()): string {
  return todayKey(now + days * 86_400_000);
}

function countByStatus(items: BatchItem[]): {
  unread: number;
  read: number;
  abandoned: number;
  invalid: number;
} {
  let unread = 0;
  let read = 0;
  let abandoned = 0;
  let invalid = 0;
  for (const item of items) {
    if (item.status === 'unread') unread++;
    else if (item.status === 'read') read++;
    else if (item.status === 'abandoned') abandoned++;
    else invalid++;
  }
  return { unread, read, abandoned, invalid };
}

function isComplete(items: BatchItem[]): boolean {
  return items.every((item) => item.status !== 'unread');
}

/**
 * Bookmarks can be deleted or moved outside the extension while a batch is locked,
 * and an MV3 service worker can be killed mid-archive. Rather than leaving the user
 * stuck, each unread item is re-checked against where its bookmark actually lives:
 *
 * - still in the queue folder      -> untouched
 * - a copy exists in the archive   -> it was archived (possibly by a torn-down
 *   worker whose state write never landed), so credit it as read
 * - gone, or moved elsewhere       -> `invalid`, which stops it blocking batch
 *   completion without counting as read
 *
 * Archiving re-creates the bookmark to refresh its saved-on date, so the original id
 * disappears — matching has to fall back to the url.
 */
async function reconcile(
  batch: CurrentBatch,
  archiveFolderId: string | null,
): Promise<{ batch: CurrentBatch; changed: boolean; recovered: BatchItem[] }> {
  let changed = false;
  const recovered: BatchItem[] = [];
  const items: BatchItem[] = [];
  for (const item of batch.items) {
    if (item.status !== 'unread') {
      items.push(item);
      continue;
    }
    const node = await getNode(item.bookmarkId);
    if (node && node.parentId === batch.folderId) {
      items.push(item);
      continue;
    }

    const archivedId = archiveFolderId
      ? await findArchivedByUrl(archiveFolderId, item.url)
      : null;
    if (archivedId) {
      const healed: BatchItem = {
        ...item,
        status: 'read',
        readAt: item.readAt ?? Date.now(),
        archivedId,
      };
      items.push(healed);
      recovered.push(healed);
      changed = true;
      continue;
    }

    items.push({ ...item, status: 'invalid' });
    changed = true;
  }
  return { batch: changed ? { ...batch, items } : batch, changed, recovered };
}

export async function loadQueueState(): Promise<QueueState> {
  const config = await getConfig();
  if (!config.folderId) return { kind: 'needs-setup' };
  if (!(await folderExists(config.folderId))) return { kind: 'folder-missing', config };

  const stored = await getCurrentBatch();
  const candidates = await listCandidates(config.folderId);

  // A batch drawn from a different folder is meaningless after the user re-points
  // the extension, so it is discarded rather than migrated.
  const batch = stored && stored.folderId === config.folderId ? stored : null;

  if (!batch) {
    if (stored) await setCurrentBatch(null);
    if (candidates.length === 0) return { kind: 'empty-folder', config };
    return { kind: 'no-batch', config, availableCount: candidates.length };
  }

  const archiveFolderId = await findArchiveFolder(config.folderId, config.archiveFolderName);
  const { batch: reconciled, changed, recovered } = await reconcile(batch, archiveFolderId);
  if (changed) {
    await setCurrentBatch(reconciled);
    // Reads whose stats write was lost still deserve credit.
    for (let i = 0; i < recovered.length; i++) {
      const item = recovered[i] as BatchItem;
      await recordRead(Date.now(), i === recovered.length - 1 && isComplete(reconciled.items), item);
    }
  }

  const inBatch = new Set(reconciled.items.map((item) => item.bookmarkId));
  const availableCount = candidates.filter((c) => !inBatch.has(c.bookmarkId)).length;
  const counts = countByStatus(reconciled.items);
  const stats = await getStats();

  // The reroll allowance now refills daily rather than being spent once per batch,
  // but committing to a batch (reading any of it) still closes the door — otherwise
  // the hard articles could be swapped out indefinitely.
  const usedToday = stats.lastRerollDate === todayKey();
  const started = counts.read > 0 || counts.abandoned > 0;
  const rerollBlockedBy: 'none' | 'used-today' | 'already-started' = started
    ? 'already-started'
    : usedToday
      ? 'used-today'
      : 'none';

  return {
    kind: 'batch',
    config,
    batch: reconciled,
    unreadCount: counts.unread,
    readCount: counts.read,
    abandonedCount: counts.abandoned,
    invalidCount: counts.invalid,
    availableCount,
    complete: counts.unread === 0,
    canReroll: rerollBlockedBy === 'none' && counts.unread > 0,
    rerollBlockedBy,
  };
}

export interface DrawResult {
  ok: boolean;
  reason?:
    | 'locked'
    | 'reroll-used'
    | 'already-started'
    | 'not-configured'
    | 'empty'
    | 'conflict';
  batch?: CurrentBatch;
}

/**
 * Serialises batch mutations within this JS context. The reader page and the
 * service worker each import this module separately, so this alone is not enough —
 * `revision` below handles the cross-context case.
 */
let mutation: Promise<unknown> = Promise.resolve();
function withLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutation.then(operation, operation);
  mutation = next.catch(() => undefined);
  return next;
}

/**
 * Draws a fresh batch.
 *
 * `reroll` re-draws the *current* batch and spends the daily reroll allowance.
 * Without it, a new batch may only be drawn when there is no batch or the current
 * one is finished — this is the lock that the whole product rests on.
 */
export function drawBatch(options: { reroll?: boolean } = {}): Promise<DrawResult> {
  return withLock(() => drawBatchUnlocked(options));
}

async function drawBatchUnlocked(options: { reroll?: boolean }): Promise<DrawResult> {
  const state = await loadQueueState();
  if (state.kind === 'needs-setup' || state.kind === 'folder-missing') {
    return { ok: false, reason: 'not-configured' };
  }
  if (state.kind === 'empty-folder') return { ok: false, reason: 'empty' };

  const { config } = state;
  const folderId = config.folderId as string;

  const observed = state.kind === 'batch' ? state.batch : null;

  if (state.kind === 'batch') {
    if (options.reroll) {
      if (!state.canReroll) {
        return {
          ok: false,
          reason: state.rerollBlockedBy === 'already-started' ? 'already-started' : 'reroll-used',
        };
      }
    } else if (!state.complete) {
      return { ok: false, reason: 'locked' };
    }
  }

  const candidates = await listCandidates(folderId);
  if (candidates.length === 0) return { ok: false, reason: 'empty' };

  const learned = await loadLearnedPriors();
  const estimate = (candidate: { url: string }): number => estimateMinutes(candidate.url, learned);

  // On a reroll the previous picks stay eligible; the point is a different shuffle,
  // not a guarantee of entirely new articles (small folders would make that impossible).
  const picked = pickBatch(config.strategy, {
    candidates,
    size: Math.min(config.batchSize, candidates.length),
    estimate,
  });

  // Another context (a second reader tab) may have drawn while we were picking.
  // Re-reading immediately before the write keeps the reroll allowance honest.
  const latest = await getCurrentBatch();
  if ((latest?.revision ?? null) !== (observed?.revision ?? null)) {
    return { ok: false, reason: 'conflict' };
  }

  const batch: CurrentBatch = {
    items: picked.map((candidate) => ({
      ...candidate,
      status: 'unread',
      estimatedMinutes: estimate(candidate),
    })),
    drawnAt: Date.now(),
    folderId,
    batchSize: config.batchSize,
    revision: (observed?.revision ?? 0) + 1,
  };

  // Spending the allowance is part of the same guarded section as the draw itself.
  if (options.reroll) {
    const stats = await getStats();
    await setStats({ ...stats, lastRerollDate: todayKey() });
  }

  await setCurrentBatch(batch);
  return { ok: true, batch };
}

export interface MarkReadResult {
  ok: boolean;
  missing?: boolean;
  error?: string;
  complete?: boolean;
}

/**
 * Archiving deletes the original bookmark, which fires `bookmarks.onRemoved`.
 * Without this guard the background's invalidation listener could race the write
 * below and flip a just-finished article to `invalid`. If the worker dies
 * mid-archive and loses this set, `reconcile` recovers the read on the next load.
 */
const archiving = new Set<string>();

/** Archives the bookmark and records the read. */
export function markRead(bookmarkId: string): Promise<MarkReadResult> {
  return withLock(() => markReadUnlocked(bookmarkId));
}

async function markReadUnlocked(bookmarkId: string): Promise<MarkReadResult> {
  const config = await getConfig();
  const batch = await getCurrentBatch();
  if (!config.folderId || !batch) return { ok: false, error: 'no-batch' };

  const item = batch.items.find((entry) => entry.bookmarkId === bookmarkId);
  if (!item) return { ok: false, error: 'not-in-batch' };
  if (item.status === 'read') return { ok: true, complete: isComplete(batch.items) };

  archiving.add(bookmarkId);
  try {
    const archived = await archiveBookmark(bookmarkId, config.folderId, config.archiveFolderName);
    if (!archived.ok && !archived.missing) return { ok: false, error: archived.error };

    // Re-read rather than reusing the snapshot above: another context may have
    // marked a different article while the bookmark work was in flight.
    const current = (await getCurrentBatch()) ?? batch;
    if (current.revision !== batch.revision) return { ok: false, error: 'conflict' };

    const now = Date.now();
    const updated: BatchItem = {
      ...item,
      status: 'read',
      readAt: now,
      ...(archived.archivedId ? { archivedId: archived.archivedId } : {}),
    };
    const items = current.items.map((entry) =>
      entry.bookmarkId === bookmarkId ? updated : entry,
    );
    await setCurrentBatch({ ...current, items });

    // Completion is credited the moment the last article is cleared, not when the
    // next batch is drawn — otherwise the counter reads 0 right after finishing.
    const complete = isComplete(items);
    await recordRead(now, complete, updated);

    return { ok: true, missing: archived.missing, complete };
  } finally {
    archiving.delete(bookmarkId);
  }
}

export interface AbandonResult {
  ok: boolean;
  error?: string;
  complete?: boolean;
}

/**
 * Drops an article the user has decided not to read. Unlike archiving this is
 * destructive — the bookmark is removed outright — so the UI asks for confirmation
 * before calling it.
 */
export function abandon(bookmarkId: string): Promise<AbandonResult> {
  return withLock(() => abandonUnlocked(bookmarkId));
}

async function abandonUnlocked(bookmarkId: string): Promise<AbandonResult> {
  const batch = await getCurrentBatch();
  if (!batch) return { ok: false, error: 'no-batch' };

  const item = batch.items.find((entry) => entry.bookmarkId === bookmarkId);
  if (!item) return { ok: false, error: 'not-in-batch' };
  if (item.status !== 'unread') return { ok: true, complete: isComplete(batch.items) };

  archiving.add(bookmarkId);
  try {
    const removed = await removeBookmark(bookmarkId);
    if (!removed.ok) return { ok: false, error: removed.error };

    const current = (await getCurrentBatch()) ?? batch;
    if (current.revision !== batch.revision) return { ok: false, error: 'conflict' };

    const items = current.items.map((entry) =>
      entry.bookmarkId === bookmarkId ? { ...entry, status: 'abandoned' as const } : entry,
    );
    await setCurrentBatch({ ...current, items });

    const stats = await getStats();
    const complete = isComplete(items);
    await setStats({
      ...stats,
      totalAbandoned: stats.totalAbandoned + 1,
      batchesCompleted: stats.batchesCompleted + (complete ? 1 : 0),
    });

    return { ok: true, complete };
  } finally {
    archiving.delete(bookmarkId);
  }
}

async function recordRead(now: number, batchCompleted: boolean, item: BatchItem): Promise<void> {
  const stats = await getStats();
  const today = todayKey(now);
  const yesterday = dayKeyOffset(-1, now);

  let streakDays = stats.streakDays;
  if (stats.lastReadDate === today) {
    streakDays = Math.max(1, streakDays);
  } else if (stats.lastReadDate === yesterday) {
    streakDays = streakDays + 1;
  } else {
    streakDays = 1;
  }

  // Focus mode reports the real length; otherwise fall back to the time estimate so
  // the "books read" milestone still moves for people who read outside focus mode.
  const words = item.words ?? wordsFromMinutes(item.estimatedMinutes);

  const next: Stats = {
    ...stats,
    totalRead: stats.totalRead + 1,
    totalWords: stats.totalWords + words,
    streakDays,
    lastReadDate: today,
    dailyCounts: { ...stats.dailyCounts, [today]: (stats.dailyCounts[today] ?? 0) + 1 },
    batchesCompleted: stats.batchesCompleted + (batchCompleted ? 1 : 0),
  };
  await setStats(next);
}

/** Records the real article length measured by focus mode, for the books milestone. */
export async function recordWordCount(bookmarkId: string, words: number): Promise<void> {
  if (!Number.isFinite(words) || words <= 0) return;
  const batch = await getCurrentBatch();
  if (!batch) return;
  const target = batch.items.find((item) => item.bookmarkId === bookmarkId);
  if (!target || target.words === words) return;
  const items = batch.items.map((item) =>
    item.bookmarkId === bookmarkId ? { ...item, words } : item,
  );
  await setCurrentBatch({ ...batch, items });
}

/**
 * Called from the background when a bookmark is deleted or moved while a batch is
 * open. Re-ordering a bookmark inside the queue folder also fires `onMoved`, so the
 * node's parent is re-checked before anything is invalidated.
 */
export async function invalidateBookmark(bookmarkId: string): Promise<boolean> {
  if (archiving.has(bookmarkId)) return false;
  const batch = await getCurrentBatch();
  if (!batch) return false;
  const target = batch.items.find((item) => item.bookmarkId === bookmarkId);
  if (!target || target.status !== 'unread') return false;

  const node = await getNode(bookmarkId);
  if (node && node.parentId === batch.folderId) return false;

  const items = batch.items.map((item) =>
    item.bookmarkId === bookmarkId ? { ...item, status: 'invalid' as const } : item,
  );
  await setCurrentBatch({ ...batch, items });
  return true;
}

export async function markOpened(bookmarkId: string): Promise<void> {
  const batch = await getCurrentBatch();
  if (!batch) return;
  const target = batch.items.find((item) => item.bookmarkId === bookmarkId);
  if (!target || target.openedAt) return;
  const items = batch.items.map((item) =>
    item.bookmarkId === bookmarkId ? { ...item, openedAt: Date.now() } : item,
  );
  await setCurrentBatch({ ...batch, items });
}
