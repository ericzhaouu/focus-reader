import {
  DEFAULT_CONFIG,
  DEFAULT_FOCUS_PREFS,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  SELECTION_STRATEGIES,
  type Config,
  type CurrentBatch,
  type FocusPrefs,
  type FocusTheme,
  type Stats,
} from './types';

const KEY_CONFIG = 'config';
const KEY_BATCH = 'currentBatch';
const KEY_STATS = 'stats';
const KEY_FOCUS_PREFS = 'focusPrefs';

const THEMES: readonly FocusTheme[] = ['light', 'dark', 'sepia'];

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
    focusMode: record.focusMode ?? DEFAULT_CONFIG.focusMode,
  };
}

function normaliseFocusPrefs(raw: unknown): FocusPrefs {
  const record = (raw ?? {}) as Partial<FocusPrefs>;
  return {
    fontSize: clamp(record.fontSize ?? DEFAULT_FOCUS_PREFS.fontSize, 14, 28),
    lineHeight: Math.min(2.4, Math.max(1.3, Number(record.lineHeight) || DEFAULT_FOCUS_PREFS.lineHeight)),
    contentWidth: clamp(record.contentWidth ?? DEFAULT_FOCUS_PREFS.contentWidth, 560, 1040),
    theme: THEMES.includes(record.theme as never) ? (record.theme as FocusTheme) : DEFAULT_FOCUS_PREFS.theme,
    disabledDomains: Array.isArray(record.disabledDomains)
      ? record.disabledDomains.filter((d): d is string => typeof d === 'string')
      : [],
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

export async function getFocusPrefs(): Promise<FocusPrefs> {
  return normaliseFocusPrefs(await readKey(KEY_FOCUS_PREFS));
}

export async function patchFocusPrefs(patch: Partial<FocusPrefs>): Promise<FocusPrefs> {
  const next = normaliseFocusPrefs({ ...(await getFocusPrefs()), ...patch });
  await chrome.storage.local.set({ [KEY_FOCUS_PREFS]: next });
  return next;
}

export type StorageKey = typeof KEY_CONFIG | typeof KEY_BATCH | typeof KEY_STATS | typeof KEY_FOCUS_PREFS;

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
