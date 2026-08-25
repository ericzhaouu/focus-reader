import { useCallback, useEffect, useRef, useState } from 'react';
import { drawBatch, loadQueueState, type QueueState } from '../lib/batch';
import { getFolderPath } from '../lib/bookmarks';
import { t } from '../lib/i18n';
import { onBatchUpdated, sendMessage } from '../lib/messaging';
import { getStats } from '../lib/storage';
import { effectiveStrategy, selectorLabel } from '../lib/selection';
import { DEFAULT_STATS, type BatchItem, type Stats } from '../lib/types';
import ArticleCard from './ArticleCard';
import StatsPanel from './StatsPanel';

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}

export default function App() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    const [nextQueue, nextStats] = await Promise.all([
      loadQueueState(),
      getStats(),
    ]);
    setQueue(nextQueue);
    setStats(nextStats);
    if (nextQueue.kind !== 'needs-setup' && nextQueue.config.folderId) {
      setFolderPath(await getFolderPath(nextQueue.config.folderId));
    } else {
      setFolderPath(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onBatchUpdated(() => void refresh()), [refresh]);

  // Coming back from an article is the most common way state goes stale.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const handleOpen = useCallback((item: BatchItem) => {
    void sendMessage({ type: 'OPEN_ARTICLE', bookmarkId: item.bookmarkId, url: item.url });
  }, []);

  const handleMarkRead = useCallback(
    async (item: BatchItem) => {
      setBusy(true);
      try {
        const result = await sendMessage({ type: 'MARK_READ', bookmarkId: item.bookmarkId });
        if (!result.ok) {
          showToast(t('toastMarkFailed', [result.error ?? t('commonUnknownError')]));
        } else if (result.missing) {
          showToast(t('toastBookmarkMissing'));
        } else if (result.complete) {
          showToast(t('toastBatchRead'));
        } else {
          showToast(t('toastArchived'));
        }
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh, showToast],
  );

  const handleAbandon = useCallback(
    async (item: BatchItem) => {
      setBusy(true);
      try {
        const result = await sendMessage({ type: 'ABANDON', bookmarkId: item.bookmarkId });
        if (!result.ok) {
          showToast(t('toastAbandonFailed', [result.error ?? t('commonUnknownError')]));
        } else if (result.complete) {
          showToast(t('toastBatchProcessed'));
        } else {
          showToast(t('toastAbandoned'));
        }
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh, showToast],
  );

  const handleDraw = useCallback(
    async (reroll: boolean) => {
      setBusy(true);
      try {
        const result = await drawBatch({ reroll });
        if (!result.ok) {
          const messages: Record<string, string> = {
            locked: t('toastLocked'),
            'reroll-used': t('toastRerollUsed'),
            'already-started': t('toastRerollStarted'),
            'not-configured': t('toastNotConfigured'),
            empty: t('toastFolderEmpty'),
            conflict: t('toastConflict'),
          };
          showToast(messages[result.reason ?? ''] ?? t('toastDrawFailed'));
        } else if (reroll) {
          showToast(t('toastRerolled'));
        }
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh, showToast],
  );

  const header = (
    <header className="header">
      <div>
        <h1>{t('readerPageTitle')}</h1>
        <div className="header__meta">
          {folderPath ? t('readerFromFolder', [folderPath]) : t('readerTagline')}
        </div>
      </div>
      <div className="header__actions">
        <button className="btn btn--ghost" onClick={openOptions}>
          {t('commonSettings')}
        </button>
      </div>
    </header>
  );

  if (!queue) {
    return (
      <div className="page">
        {header}
        <div className="state">
          <div className="state__text">{t('readerLoading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {header}

      {queue.kind === 'needs-setup' && (
        <div className="state">
          <div className="state__glyph">📚</div>
          <div className="state__title">{t('readerSetupTitle')}</div>
          <p className="state__text">{t('readerSetupText')}</p>
          <button className="btn btn--primary btn--lg" onClick={openOptions}>
            {t('readerGoToSettings')}
          </button>
        </div>
      )}

      {queue.kind === 'folder-missing' && (
        <div className="state">
          <div className="state__glyph">🔍</div>
          <div className="state__title">{t('readerFolderMissingTitle')}</div>
          <p className="state__text">{t('readerFolderMissingText')}</p>
          <button className="btn btn--primary btn--lg" onClick={openOptions}>
            {t('readerChooseAgain')}
          </button>
        </div>
      )}

      {queue.kind === 'empty-folder' && (
        <div className="state">
          <div className="state__glyph">🌱</div>
          <div className="state__title">{t('readerFolderEmptyTitle')}</div>
          <p className="state__text">{t('readerFolderEmptyText')}</p>
          <button className="btn" onClick={openOptions}>
            {t('readerChangeFolder')}
          </button>
        </div>
      )}

      {queue.kind === 'no-batch' && (
        <div className="state">
          <div className="state__glyph">🎯</div>
          <div className="state__title">{t('readerReadyTitle')}</div>
          <p className="state__text">
            {t('readerReadyText', [queue.availableCount, queue.config.batchSize])}
          </p>
          <button
            className="btn btn--primary btn--lg"
            onClick={() => void handleDraw(false)}
            disabled={busy}
          >
            {t('readerDrawCount', [Math.min(queue.config.batchSize, queue.availableCount)])}
          </button>
        </div>
      )}

      {queue.kind === 'batch' && (
        <>
          <div className="progress">
            <div className="progress__top">
              <div className="progress__count">
                <em>{t('readerReadProgress', [queue.readCount, queue.batch.items.length])}</em>
                {queue.abandonedCount > 0 && (
                  <span className="subtle">
                    {' · '}
                    {t('readerAbandonedCount', [queue.abandonedCount])}
                  </span>
                )}
                {queue.invalidCount > 0 && (
                  <span className="subtle">
                    {' · '}
                    {t('readerInvalidCount', [queue.invalidCount])}
                  </span>
                )}
              </div>
              <div className="row">
                <span className="subtle">
                  {selectorLabel(effectiveStrategy(queue.config.strategy))}
                </span>
                <button
                  className="btn"
                  onClick={() => void handleDraw(true)}
                  disabled={busy || !queue.canReroll}
                  title={
                    queue.canReroll
                      ? t('readerRerollAvailableTitle')
                      : queue.rerollBlockedBy === 'already-started'
                        ? t('readerRerollStartedTitle')
                        : t('readerRerollUsedTitle')
                  }
                >
                  {queue.canReroll
                    ? t('readerRerollAvailable')
                    : queue.rerollBlockedBy === 'already-started'
                      ? t('readerRerollStarted')
                      : t('readerRerollUsed')}
                </button>
              </div>
            </div>
            <div className="progress__bar">
              <div
                className="progress__fill"
                style={{
                  width: `${
                    queue.batch.items.length
                      ? ((queue.readCount + queue.abandonedCount + queue.invalidCount) /
                          queue.batch.items.length) *
                        100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          {queue.complete && (
            <div className="state" style={{ marginBottom: 20 }}>
              <div className="state__glyph">🎉</div>
              <div className="state__title">{t('readerCompleteTitle')}</div>
              <p className="state__text">
                {queue.availableCount > 0
                  ? t('readerCompleteMore', [queue.availableCount])
                  : t('readerCompleteEmpty')}
              </p>
              <button
                className="btn btn--primary btn--lg"
                onClick={() => void handleDraw(false)}
                disabled={busy || queue.availableCount === 0}
              >
                {t('readerDrawNext')}
              </button>
            </div>
          )}

          <div className="card-list">
            {queue.batch.items.map((item, index) => (
              <ArticleCard
                key={item.bookmarkId}
                item={item}
                index={index}
                busy={busy}
                onOpen={handleOpen}
                onMarkRead={(target) => void handleMarkRead(target)}
                onAbandon={(target) => void handleAbandon(target)}
              />
            ))}
          </div>

          {!queue.complete && (
            <p className="subtle" style={{ marginTop: 16, textAlign: 'center' }}>
              {t('readerRemaining', [queue.unreadCount])}
            </p>
          )}

          <StatsPanel stats={stats} />
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
