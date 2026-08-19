import { useCallback, useEffect, useRef, useState } from 'react';
import { drawBatch, loadQueueState, type QueueState } from '../lib/batch';
import { getFolderPath } from '../lib/bookmarks';
import { onBatchUpdated, sendMessage } from '../lib/messaging';
import { getStats } from '../lib/storage';
import { getSelector, effectiveStrategy } from '../lib/selection';
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
          showToast(`标记失败：${result.error ?? '未知错误'}`);
        } else if (result.missing) {
          showToast('这条书签已不在收藏夹里，已从清单中清除');
        } else if (result.complete) {
          showToast('这一批读完了 🎉');
        } else {
          showToast('已归档，收藏时间更新为今天');
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
        if (!result.ok) showToast(`放弃失败：${result.error ?? '未知错误'}`);
        else if (result.complete) showToast('这一批处理完了');
        else showToast('已放弃，这条收藏已删除');
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
            locked: '当前这批还没处理完，先把它清空吧',
            'reroll-used': '今天的重选机会已经用掉了，明天再来',
            'already-started': '这批已经开始读了，不能再整批重选——单篇可以「放弃」',
            'not-configured': '还没选择待读文件夹',
            empty: '待读文件夹里没有可读的文章',
            conflict: '状态刚被另一个标签页改动，已刷新',
          };
          showToast(messages[result.reason ?? ''] ?? '抽取失败');
        } else if (reroll) {
          showToast('已重新抽取，今天的重选用完了');
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
        <h1>阅读清单</h1>
        <div className="header__meta">
          {folderPath ? `来自 ${folderPath}` : '把收藏夹变成一份读得完的清单'}
        </div>
      </div>
      <div className="header__actions">
        <button className="btn btn--ghost" onClick={openOptions}>
          设置
        </button>
      </div>
    </header>
  );

  if (!queue) {
    return (
      <div className="page">
        {header}
        <div className="state">
          <div className="state__text">正在读取你的收藏夹…</div>
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
          <div className="state__title">先选一个待读文件夹</div>
          <p className="state__text">
            指定收藏夹里存放待读文章的那个文件夹，之后每次打开这里，都只会看到从中抽出的一小批。
          </p>
          <button className="btn btn--primary btn--lg" onClick={openOptions}>
            去设置
          </button>
        </div>
      )}

      {queue.kind === 'folder-missing' && (
        <div className="state">
          <div className="state__glyph">🔍</div>
          <div className="state__title">找不到待读文件夹了</div>
          <p className="state__text">这个文件夹可能已被删除或重命名，重新指定一个就好。</p>
          <button className="btn btn--primary btn--lg" onClick={openOptions}>
            重新选择
          </button>
        </div>
      )}

      {queue.kind === 'empty-folder' && (
        <div className="state">
          <div className="state__glyph">🌱</div>
          <div className="state__title">待读文件夹是空的</div>
          <p className="state__text">
            去收藏几篇想读的文章吧。收藏行为完全不受限制——受限的只是你一次能看到多少。
          </p>
          <button className="btn" onClick={openOptions}>
            换一个文件夹
          </button>
        </div>
      )}

      {queue.kind === 'no-batch' && (
        <div className="state">
          <div className="state__glyph">🎯</div>
          <div className="state__title">准备好开始了</div>
          <p className="state__text">
            待读文件夹里有 {queue.availableCount} 篇文章。抽取后会锁定 {queue.config.batchSize}{' '}
            篇，读完才能抽下一批。
          </p>
          <button
            className="btn btn--primary btn--lg"
            onClick={() => void handleDraw(false)}
            disabled={busy}
          >
            抽取 {Math.min(queue.config.batchSize, queue.availableCount)} 篇
          </button>
        </div>
      )}

      {queue.kind === 'batch' && (
        <>
          <div className="progress">
            <div className="progress__top">
              <div className="progress__count">
                <em>{queue.readCount}</em>/ {queue.batch.items.length} 已读
                {queue.abandonedCount > 0 && (
                  <span className="subtle">　{queue.abandonedCount} 篇已放弃</span>
                )}
                {queue.invalidCount > 0 && (
                  <span className="subtle">　{queue.invalidCount} 篇已失效</span>
                )}
              </div>
              <div className="row">
                <span className="subtle">
                  {getSelector(effectiveStrategy(queue.config.strategy)).label}
                </span>
                <button
                  className="btn"
                  onClick={() => void handleDraw(true)}
                  disabled={busy || !queue.canReroll}
                  title={
                    queue.canReroll
                      ? '每天可以整批重选一次'
                      : queue.rerollBlockedBy === 'already-started'
                        ? '这批已经开始处理了，不能再整批重选——单篇可以「放弃」'
                        : '今天的重选机会已用完，明天恢复'
                  }
                >
                  {queue.canReroll
                    ? '重选（今日剩 1 次）'
                    : queue.rerollBlockedBy === 'already-started'
                      ? '已开始，不可重选'
                      : '今日重选已用完'}
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
              <div className="state__title">这一批处理完了</div>
              <p className="state__text">
                {queue.availableCount > 0
                  ? `待读文件夹里还有 ${queue.availableCount} 篇。要继续吗？`
                  : '待读文件夹已经清空了。去收藏一些新的吧。'}
              </p>
              <button
                className="btn btn--primary btn--lg"
                onClick={() => void handleDraw(false)}
                disabled={busy || queue.availableCount === 0}
              >
                抽取下一批
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
              还剩 {queue.unreadCount} 篇。这批处理完之前，这里不会出现新文章——你的收藏夹不受任何影响。
            </p>
          )}

          <StatsPanel stats={stats} />
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
