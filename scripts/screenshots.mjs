/**
 * Captures Chrome Web Store listing screenshots at the required 1280x800.
 *
 * Everything shown is the real extension: a real Chrome loads the real build,
 * reads real bookmarks, and the focus-mode shot renders the actual shipped
 * `focus-inject.js` against a real article page. Only the reading history is
 * pre-seeded, so the milestone panel shows a representative mid-journey state
 * rather than an empty one.
 *
 * Run with: npm run screenshots
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, findChrome, freePort, launchChrome, sleep, waitForEndpoint } from './cdp.mjs';
import { startArticleServer } from './sample-articles.mjs';

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

const injectSource = readFileSync(join(DIST, 'focus-inject.js'), 'utf8');
mkdirSync(OUT, { recursive: true });

const { port: articlePort } = await startArticleServer();
const base = `http://127.0.0.1:${articlePort}`;

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
          archiveFolderName: '已读归档', focusMode: true,
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

  // The permission prompt is transient onboarding UI; the listing should show the
  // steady state a user sees once focus mode is set up.
  await browser.evaluate(`document.querySelector('.banner')?.remove()`, reader.sessionId);
  await capture(reader.sessionId, '1-reading-list', '锁定的阅读清单');

  await browser.evaluate(
    `document.querySelector('.equiv').scrollIntoView({ block: 'end' }); window.scrollBy(0, 90);`,
    reader.sessionId,
  );
  await capture(reader.sessionId, '3-milestone', '阅读量换算成书籍等价');

  browser.close();
} finally {
  await chrome.dispose();
}

// ---- shot 2: focus reading mode -----------------------------------------
// Deliberately a separate browser with no extension installed. In an instance
// where an extension is loaded, Chrome keeps reclaiming the page's `chrome`
// object, so the messaging stub the bundle needs cannot be kept in place — and
// the bundle swallows that failure by design, leaving no reader view to shoot.
// The rendering path exercised here is still entirely the shipped bundle.
const focusPort = await freePort();
const focusChrome = launchChrome({
  port: focusPort,
  extraArgs: [`--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars'],
});

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${focusPort}/json/version`);
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const { require_, capture, openPage } = makeHelpers(browser);

  const article = await openPage(`${base}/a/why-we-save`);
  const stubbed = await browser.evaluate(
    `(() => {
       window.chrome = { runtime: { sendMessage: (m) => Promise.resolve(
         m.type === 'GET_FOCUS_CONTEXT'
           ? { bookmarkId: 'demo', url: location.href, enabled: true,
               prefs: { fontSize: 19, lineHeight: 1.75, contentWidth: 720,
                        theme: 'light', disabledDomains: [] } }
           : { ok: true }) } };
       return typeof window.chrome.runtime.sendMessage === 'function';
     })()`,
    article.sessionId,
  );
  if (stubbed !== true) throw new Error('无法为专注模式安装消息桩');

  await browser.evaluate(injectSource, article.sessionId);
  await require_(
    article.sessionId,
    `!!document.getElementById('__focus_reader_root__')?.shadowRoot?.querySelector('.wrap')`,
    '专注阅读视图挂载',
  );
  // The view fades in over 180ms; capturing mid-animation lets the original page
  // show through. Settle it deterministically rather than sleeping and hoping.
  await browser.evaluate(
    `(() => {
       const shadow = document.getElementById('__focus_reader_root__').shadowRoot;
       const style = document.createElement('style');
       style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
       shadow.appendChild(style);
     })()`,
    article.sessionId,
  );
  await require_(
    article.sessionId,
    `(() => {
       const w = document.getElementById('__focus_reader_root__').shadowRoot.querySelector('.wrap');
       const s = getComputedStyle(w);
       const r = w.getBoundingClientRect();
       // Opaque, fully faded in, and actually covering the viewport.
       return s.opacity === '1'
         && !/rgba\\(.*0\\)$/.test(s.backgroundColor)
         && r.width >= ${WIDTH - 2} && r.height >= ${HEIGHT - 2};
     })()`,
    '阅读视图完全不透明并铺满视口',
  );
  await capture(article.sessionId, '2-focus-mode', '专注阅读模式');

  browser.close();
} finally {
  await focusChrome.dispose();
}

console.log(`
  ${shots.length} 张截图已生成 → store-assets/
  尺寸 ${WIDTH}×${HEIGHT}，符合 Chrome 应用商店要求。
`);
