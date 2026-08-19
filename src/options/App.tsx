import { useCallback, useEffect, useRef, useState } from 'react';
import { countCandidates, getFolderPath, getFolderTree } from '../lib/bookmarks';
import { AVAILABLE_STRATEGIES, SELECTORS, effectiveStrategy } from '../lib/selection';
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
      showToast('已保存');
      if ('folderId' in patch) await refreshFolderInfo(next.folderId);
      return next;
    },
    [refreshFolderInfo, showToast],
  );

  if (!config) {
    return (
      <div className="page page--narrow">
        <h1>设置</h1>
        <p className="muted">加载中…</p>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <header className="header">
        <div>
          <h1>Focus Reader 设置</h1>
          <div className="header__meta">读完一批，才有下一批。</div>
        </div>
      </header>

      <section className="section">
        <div className="section__head">
          <h2>待读文件夹</h2>
          <div className="section__desc">
            插件只从这个文件夹的直接子书签中抽取文章，子文件夹里的内容不会被打扰。
          </div>
        </div>
        <FolderPicker
          nodes={tree}
          selectedId={config.folderId}
          onSelect={(id) => void updateConfig({ folderId: id })}
        />
        {folderPath && (
          <div className="field__hint">
            当前：{folderPath}
            {candidateCount !== null && ` — ${candidateCount} 篇待读`}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2>批次</h2>
          <div className="section__desc">
            每批的篇数与选文方式。修改篇数会在下一批生效，不会打断当前锁定的批次。
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="batch-size">
            每批篇数
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
                  {size} 篇
                </option>
              ),
            )}
          </select>
          <div className="field__hint">上限 10 篇——超过这个数，清单就又变成收藏夹了。</div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="strategy">
            选文方式
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
                {SELECTORS[strategy].label}
              </option>
            ))}
          </select>
          <div className="field__hint">
            {SELECTORS[effectiveStrategy(config.strategy)].description}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="archive">
            已读归档文件夹名
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
            读完的文章会<strong>移动</strong>到待读文件夹下的这个子文件夹，永远不会被删除。
          </div>
        </div>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
