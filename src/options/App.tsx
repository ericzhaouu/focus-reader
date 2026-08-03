import { useCallback, useEffect, useRef, useState } from 'react';
import { countCandidates, getFolderPath, getFolderTree } from '../lib/bookmarks';
import { hasHostAccess, onHostAccessChanged, removeHostAccess, requestHostAccess } from '../lib/permissions';
import { AVAILABLE_STRATEGIES, SELECTORS, effectiveStrategy } from '../lib/selection';
import { getConfig, getFocusPrefs, patchConfig, patchFocusPrefs } from '../lib/storage';
import {
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
  type Config,
  type FocusPrefs,
  type FocusTheme,
  type FolderNode,
} from '../lib/types';
import FolderPicker from './FolderPicker';

const THEME_LABELS: Record<FocusTheme, string> = {
  light: '浅色',
  dark: '深色',
  sepia: '护眼',
};

export default function App() {
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [prefs, setPrefs] = useState<FocusPrefs | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [hostGranted, setHostGranted] = useState(false);
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
      const [nextTree, nextConfig, nextPrefs, granted] = await Promise.all([
        getFolderTree(),
        getConfig(),
        getFocusPrefs(),
        hasHostAccess(),
      ]);
      setTree(nextTree);
      setConfig(nextConfig);
      setPrefs(nextPrefs);
      setArchiveDraft(nextConfig.archiveFolderName);
      setHostGranted(granted);
      await refreshFolderInfo(nextConfig.folderId);
    })();
  }, [refreshFolderInfo]);

  useEffect(() => onHostAccessChanged(setHostGranted), []);
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

  const updatePrefs = useCallback(
    async (patch: Partial<FocusPrefs>) => {
      const next = await patchFocusPrefs(patch);
      setPrefs(next);
      return next;
    },
    [],
  );

  if (!config || !prefs) {
    return (
      <div className="page page--narrow">
        <h1>设置</h1>
        <p className="muted">加载中…</p>
      </div>
    );
  }

  // Chrome only shows the permission prompt inside a user gesture, so the request
  // must be the first thing the click handler does.
  const handleFocusToggle = (checked: boolean): void => {
    if (checked && !hostGranted) {
      void requestHostAccess().then((granted) => {
        setHostGranted(granted);
        void updateConfig({ focusMode: true });
        if (!granted) showToast('未授予权限，专注模式暂时不会生效');
      });
      return;
    }
    void updateConfig({ focusMode: checked });
  };

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

      <section className="section">
        <div className="section__head">
          <h2>专注阅读模式</h2>
          <div className="section__desc">
            打开文章时把正文提取出来，渲染成无干扰的阅读视图。所有处理都在本地完成，内容不会离开你的电脑。
          </div>
        </div>

        <div className="field toggle-row">
          <div>
            <div className="field__label">启用专注阅读模式</div>
            <div className="field__hint">
              {hostGranted
                ? '已授予网页读取权限。'
                : '需要授予读取网页内容的权限；不授予也不影响清单、归档与统计。'}
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.focusMode}
              onChange={(event) => handleFocusToggle(event.target.checked)}
            />
            <span className="switch__track" />
          </label>
        </div>

        {config.focusMode && (
          <>
            {!hostGranted && (
              <div className="banner banner--warning">
                <div className="banner__body">
                  <div className="banner__title">还缺少网页读取权限</div>
                  <div className="muted">授予后才能渲染阅读视图。</div>
                </div>
                <button
                  className="btn btn--primary"
                  onClick={() => void requestHostAccess().then(setHostGranted)}
                >
                  授予权限
                </button>
              </div>
            )}

            <div className="field">
              <label className="field__label" htmlFor="font-size">
                正文字号：{prefs.fontSize}px
              </label>
              <input
                id="font-size"
                type="range"
                min={14}
                max={28}
                step={1}
                value={prefs.fontSize}
                onChange={(event) => void updatePrefs({ fontSize: Number(event.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="line-height">
                行距：{prefs.lineHeight.toFixed(2)}
              </label>
              <input
                id="line-height"
                type="range"
                min={1.3}
                max={2.4}
                step={0.05}
                value={prefs.lineHeight}
                onChange={(event) => void updatePrefs({ lineHeight: Number(event.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="content-width">
                内容宽度：{prefs.contentWidth}px
              </label>
              <input
                id="content-width"
                type="range"
                min={560}
                max={1040}
                step={20}
                value={prefs.contentWidth}
                onChange={(event) => void updatePrefs({ contentWidth: Number(event.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="theme">
                阅读主题
              </label>
              <select
                id="theme"
                className="select"
                value={prefs.theme}
                onChange={(event) => void updatePrefs({ theme: event.target.value as FocusTheme })}
              >
                {(Object.keys(THEME_LABELS) as FocusTheme[]).map((theme) => (
                  <option key={theme} value={theme}>
                    {THEME_LABELS[theme]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <div className="field__label">已关闭专注模式的网站</div>
              {prefs.disabledDomains.length === 0 ? (
                <div className="field__hint">
                  还没有。在阅读视图里点「看原页」时，可以选择让某个网站以后都不再自动进入专注模式。
                </div>
              ) : (
                <div className="chip-list">
                  {prefs.disabledDomains.map((domain) => (
                    <span className="chip" key={domain}>
                      {domain}
                      <button
                        type="button"
                        title="恢复该网站的专注模式"
                        onClick={() =>
                          void updatePrefs({
                            disabledDomains: prefs.disabledDomains.filter((d) => d !== domain),
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {hostGranted && (
              <div className="field">
                <button
                  className="btn"
                  onClick={() =>
                    void removeHostAccess().then((removed) => {
                      if (removed) {
                        setHostGranted(false);
                        showToast('已撤销网页读取权限');
                      }
                    })
                  }
                >
                  撤销网页读取权限
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
