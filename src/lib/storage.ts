import {
  DEFAULT_CONFIG,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  SELECTION_STRATEGIES,
  type Config,
  type CurrentBatch,
  type Stats,
} from './types';

const KEY_CONFIG = 'config';
const KEY_BATCH = 'currentBatch';
const KEY_STATS = 'stats';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function readKey<T>(key: string): Promise<T | undefined> {
  const bag = await chrome.storage.local.get(key);
  return bag[key] as T | undefined;
}

/** Normalises stored config so a corrupted or partial record can never crash a page. */
function normaliseConfig(raw: unknown): Config {
  const record = (raw ?? {}) as Partial<Config>;
  const strategy = SELECTION_STRATEGIES.includes(record.strategy as never)
    ? (record.strategy as Config['strategy'])
    : DEFAULT_CONFIG.strategy;
  const archiveFolderName =
    typeof record.archiveFolderName === 'string' && record.archiveFolderName.trim()
      ? record.archiveFolderName.trim()
      : DEFAULT_CONFIG.archiveFolderName;

  return {
    folderId: typeof record.folderId === 'string' && record.folderId ? record.folderId : null,
    batchSize: clamp(record.batchSize ?? DEFAULT_CONFIG.batchSize, MIN_BATCH_SIZE, MAX_BATCH_SIZE),
    strategy,
    archiveFolderName,
  };
}

function normaliseStats(raw: unknown): Stats {
  const record = (raw ?? {}) as Partial<Stats>;
  return {
    totalRead: Math.max(0, Number(record.totalRead) || 0),
    streakDays: Math.max(0, Number(record.streakDays) || 0),
    lastReadDate: typeof record.lastReadDate === 'string' ? record.lastReadDate : null,
    dailyCounts: record.dailyCounts && typeof record.dailyCounts === 'object' ? record.dailyCounts : {},
    batchesCompleted: Math.max(0, Number(record.batchesCompleted) || 0),
    totalAbandoned: Math.max(0, Number(record.totalAbandoned) || 0),
    totalWords: Math.max(0, Number(record.totalWords) || 0),
    lastRerollDate: typeof record.lastRerollDate === 'string' ? record.lastRerollDate : null,
  };
}

export async function getConfig(): Promise<Config> {
  return normaliseConfig(await readKey(KEY_CONFIG));
}

export async function patchConfig(patch: Partial<Config>): Promise<Config> {
  const next = normaliseConfig({ ...(await getConfig()), ...patch });
  await chrome.storage.local.set({ [KEY_CONFIG]: next });
  return next;
}

export async function getCurrentBatch(): Promise<CurrentBatch | null> {
  const raw = await readKey<CurrentBatch>(KEY_BATCH);
  if (!raw || !Array.isArray(raw.items) || typeof raw.folderId !== 'string') return null;
  return { ...raw, revision: Number(raw.revision) || 0 };
}

export async function setCurrentBatch(batch: CurrentBatch | null): Promise<void> {
  if (batch === null) {
    await chrome.storage.local.remove(KEY_BATCH);
    return;
  }
  await chrome.storage.local.set({ [KEY_BATCH]: batch });
}

export async function getStats(): Promise<Stats> {
  return normaliseStats(await readKey(KEY_STATS));
}

export async function setStats(stats: Stats): Promise<void> {
  await chrome.storage.local.set({ [KEY_STATS]: stats });
}

export type StorageKey = typeof KEY_CONFIG | typeof KEY_BATCH | typeof KEY_STATS;

/** Subscribe to local storage writes. Returns an unsubscribe function. */
export function onStorageChanged(listener: (keys: StorageKey[]) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const keys = Object.keys(changes) as StorageKey[];
    if (keys.length) listener(keys);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
