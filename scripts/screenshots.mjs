/**
 * Captures Chrome Web Store listing screenshots at the required 1280x800.
 *
 * A real Chrome loads the real build and real bookmarks. Only the reading history
 * is pre-seeded so the arcade panel shows a representative mid-journey state.
 *
 * Run with: npm run screenshots
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, findChrome, freePort, launchChrome, sleep, waitForEndpoint } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'store-assets');

const WIDTH = 1280;
const HEIGHT = 800;

if (!findChrome()) {
  console.error('未找到 Chrome。');
  process.exit(1);
}
if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json 不存在，请先运行 npm run build');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const shots = [];

/** Shared page setup: exact listing dimensions, light scheme, fully loaded. */
function pageOpener(browser, requireFn) {
  return async (url) => {
    const { targetId } = await browser.send('Target.createTarget', { url });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Page.enable', {}, sessionId);
    // Headless reports prefers-color-scheme: dark; most users are on light, and
    // light reads better at store-thumbnail size.
    await browser.send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: 'light' }] },
      sessionId,
    );
    await browser.send(
      'Emulation.setDeviceMetricsOverride',
      { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    // `Target.createTarget` starts on about:blank and navigates afterwards, so
    // readyState alone can describe the blank document — anything injected then is
    // wiped when the real navigation commits. Wait for the actual URL as well.
    await requireFn(
      sessionId,
      `document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(url)})`,
      `${url} 加载完成`,
    );
    return { targetId, sessionId };
  };
}

function makeHelpers(browser) {
  /** `Cdp.waitFor` resolves with the last value on timeout; screenshots must fail loudly. */
  const require_ = async (sessionId, expression, what, timeoutMs = 20_000) => {
    const value = await browser.waitFor(sessionId, expression, (v) => v === true, timeoutMs);
    if (value !== true) throw new Error(`等待超时：${what}`);
  };

  const capture = async (sessionId, name, description) => {
    await sleep(500);
    const { data } = await browser.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId,
    );
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    shots.push(name);
    console.log(`  ✓ ${name}.png — ${description}`);
  };

  return { require_, capture, openPage: pageOpener(browser, require_) };
}

// ---- shots 1 & 3: the extension's own pages ------------------------------
const debugPort = await freePort();
const chrome = launchChrome({
  port: debugPort,
  extraArgs: [`--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars'],
});

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`);
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const { require_, capture, openPage } = makeHelpers(browser);
  const { id: extensionId } = await browser.send('Extensions.loadUnpacked', { path: DIST });

  const reader = await openPage(`chrome-extension://${extensionId}/reader.html`);
  await require_(reader.sessionId, 'typeof chrome !== "undefined" && !!chrome.bookmarks', 'bookmarks API');

  const SAMPLES = [
    ['How to Do Great Work', 'https://paulgraham.com/greatwork.html'],
    ['The Bitter Lesson', 'http://incompleteideas.net/IncIdeas/BitterLesson.html'],
    ['深入理解 Shadow DOM', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Web_components/Using_shadow_DOM'],
    ['为什么我们收藏了却从不阅读', 'https://example.com/slow-reading/why-we-save'],
    ['一篇存了很久的长文', 'https://en.wikipedia.org/wiki/Attention_economy'],
    ['注意力是有预算的', 'https://example.com/deep-reading/attention-budget'],
    ['SQLite 是如何测试的', 'https://www.sqlite.org/testing.html'],
    ['论「读完」这件事', 'https://example.com/paper/on-finishing'],
  ];

  await browser.evaluate(
    `(async () => {
      const [root] = await chrome.bookmarks.getTree();
      const bar = root.children.find((n) => !n.url);
      const folder = await chrome.bookmarks.create({ parentId: bar.id, title: '待读' });
      for (const [title, url] of ${JSON.stringify(SAMPLES)}) {
        await chrome.bookmarks.create({ parentId: folder.id, title, url });
      }
      await chrome.storage.local.set({
        config: {
          folderId: folder.id, batchSize: 5, strategy: 'random',
          archiveFolderName: '已读归档',
        },
        stats: {
          totalRead: 23, streakDays: 6, lastReadDate: new Date().toISOString().slice(0, 10),
          dailyCounts: {}, batchesCompleted: 4, totalAbandoned: 5,
          totalWords: 118400, lastRerollDate: null,
        },
      });
    })()`,
    reader.sessionId,
  );

  await browser.send('Page.reload', {}, reader.sessionId);
  await require_(reader.sessionId, 'document.body.innerText.includes("准备好开始了")', '待读文件夹就绪');
  await browser.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('抽取')).click()`,
    reader.sessionId,
  );
  await require_(reader.sessionId, 'document.querySelectorAll(".card").length === 5', '批次渲染');

  await capture(reader.sessionId, '1-reading-list', '锁定的阅读清单');

  await browser.evaluate(
    `document.querySelector('.arcade').scrollIntoView({ block: 'end' }); window.scrollBy(0, 60);`,
    reader.sessionId,
  );
  await capture(reader.sessionId, '3-milestone', '街机风阅读进度');

  const options = await openPage(`chrome-extension://${extensionId}/options.html`);
  await require_(
    options.sessionId,
    `document.body.innerText.includes('Focus Reader 设置') && document.body.innerText.includes('当前：')`,
    '设置页渲染',
  );
  await capture(options.sessionId, '2-settings', '待读文件夹与批次设置');

  browser.close();
} finally {
  await chrome.dispose();
}

console.log(`
  ${shots.length} 张截图已生成 → store-assets/
  尺寸 ${WIDTH}×${HEIGHT}，符合 Chrome 应用商店要求。
`);
