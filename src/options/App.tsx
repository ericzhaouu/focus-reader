import { useCallback, useEffect, useRef, useState } from 'react';
import { countCandidates, getFolderPath, getFolderTree } from '../lib/bookmarks';
import { t } from '../lib/i18n';
import {
  AVAILABLE_STRATEGIES,
  effectiveStrategy,
  selectorDescription,
  selectorLabel,
} from '../lib/selection';
import { getConfig, patchConfig } from '../lib/storage';
import {
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  type Config,
  type FolderNode,
} from '../lib/types';
import FolderPicker from './FolderPicker';

export default function App() {
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [archiveDraft, setArchiveDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  const refreshFolderInfo = useCallback(async (folderId: string | null) => {
    if (!folderId) {
      setFolderPath(null);
      setCandidateCount(null);
      return;
    }
    const [path, count] = await Promise.all([getFolderPath(folderId), countCandidates(folderId)]);
    setFolderPath(path);
    setCandidateCount(count);
  }, []);

  useEffect(() => {
    void (async () => {
      const [nextTree, nextConfig] = await Promise.all([
        getFolderTree(),
        getConfig(),
      ]);
      setTree(nextTree);
      setConfig(nextConfig);
      setArchiveDraft(nextConfig.archiveFolderName);
      await refreshFolderInfo(nextConfig.folderId);
    })();
  }, [refreshFolderInfo]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const updateConfig = useCallback(
    async (patch: Partial<Config>) => {
      const next = await patchConfig(patch);
      setConfig(next);
      showToast(t('commonSaved'));
      if ('folderId' in patch) await refreshFolderInfo(next.folderId);
      return next;
    },
    [refreshFolderInfo, showToast],
  );

  if (!config) {
    return (
      <div className="page page--narrow">
        <h1>{t('commonSettings')}</h1>
        <p className="muted">{t('commonLoading')}</p>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <header className="header">
        <div>
          <h1>{t('optionsPageTitle')}</h1>
          <div className="header__meta">{t('optionsTagline')}</div>
        </div>
      </header>

      <section className="section">
        <div className="section__head">
          <h2>{t('optionsQueueFolderTitle')}</h2>
          <div className="section__desc">
            {t('optionsQueueFolderDescription')}
          </div>
        </div>
        <FolderPicker
          nodes={tree}
          selectedId={config.folderId}
          onSelect={(id) => void updateConfig({ folderId: id })}
        />
        {folderPath && (
          <div className="field__hint">
            {t('optionsCurrentFolder', [folderPath])}
            {candidateCount !== null && ` — ${t('optionsUnreadCount', [candidateCount])}`}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2>{t('optionsBatchTitle')}</h2>
          <div className="section__desc">
            {t('optionsBatchDescription')}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="batch-size">
            {t('optionsBatchSize')}
          </label>
          <select
            id="batch-size"
            className="select"
            value={config.batchSize}
            onChange={(event) => void updateConfig({ batchSize: Number(event.target.value) })}
          >
            {Array.from({ length: MAX_BATCH_SIZE - MIN_BATCH_SIZE + 1 }, (_, i) => i + MIN_BATCH_SIZE).map(
              (size) => (
                <option key={size} value={size}>
                  {t('optionsArticleCount', [size])}
                </option>
              ),
            )}
          </select>
          <div className="field__hint">{t('optionsBatchLimitHint')}</div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="strategy">
            {t('optionsSelectionMethod')}
          </label>
          <select
            id="strategy"
            className="select"
            value={effectiveStrategy(config.strategy)}
            onChange={(event) =>
              void updateConfig({ strategy: event.target.value as Config['strategy'] })
            }
          >
            {AVAILABLE_STRATEGIES.map((strategy) => (
              <option key={strategy} value={strategy}>
                {selectorLabel(strategy)}
              </option>
            ))}
          </select>
          <div className="field__hint">
            {selectorDescription(effectiveStrategy(config.strategy))}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="archive">
            {t('optionsArchiveName')}
          </label>
          <input
            id="archive"
            className="input"
            value={archiveDraft}
            onChange={(event) => setArchiveDraft(event.target.value)}
            onBlur={() => {
              const name = archiveDraft.trim();
              if (!name || name === config.archiveFolderName) {
                setArchiveDraft(config.archiveFolderName);
                return;
              }
              void updateConfig({ archiveFolderName: name });
            }}
          />
          <div className="field__hint">
            {t('optionsArchiveHint')}
          </div>
        </div>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
