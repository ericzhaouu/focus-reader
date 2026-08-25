/**
 * Opens a real, visible Chrome window with the extension installed and a folder of
 * sample bookmarks ready to go, so the whole flow can be clicked through by hand.
 *
 * Runs against a throwaway profile in the system temp directory — your everyday
 * Chrome profile and your real bookmarks are never touched.
 *
 * Run with: npm run try
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, findChrome, freePort, launchChrome, sleep, waitForEndpoint } from './cdp.mjs';
import { startArticleServer } from './sample-articles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

if (!findChrome()) {
  console.error('未找到 Chrome，无法启动试用环境。');
  process.exit(1);
}
if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json 不存在，请先运行 npm run build');
  process.exit(1);
}

const { port: articlePort } = await startArticleServer();
const base = `http://127.0.0.1:${articlePort}`;
console.log(`  示例文章站：${base}`);

const debugPort = await freePort();
const chrome = launchChrome({
  port: debugPort,
  // A real window, positioned and sized so it is comfortable to click through.
  headless: false,
  extraArgs: ['--lang=zh-CN', '--window-size=1280,900', '--window-position=80,40'],
});

const version = await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`);
console.log(`  ${version.Browser}`);

const browser = await Cdp.connect(version.webSocketDebuggerUrl);
const { id: extensionId } = await browser.send('Extensions.loadUnpacked', { path: DIST });
console.log(`  扩展已安装：${extensionId}`);

const { targetId } = await browser.send('Target.createTarget', {
  url: `chrome-extension://${extensionId}/reader.html`,
});
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
await browser.waitFor(sessionId, 'typeof chrome !== "undefined" && !!chrome.bookmarks', (v) => v === true);

// Created in order, so dateAdded ascends down this list and "oldest first" is meaningful.
const SAMPLES = [
  ['一篇存了很久的长文', 'https://en.wikipedia.org/wiki/Attention_economy'],
  ['Reflections on Trusting Trust', 'https://www.cs.cmu.edu/~rdriley/487/papers/Thompson_1984_ReflectionsonTrustingTrust.pdf'],
  ['The Bitter Lesson', 'http://incompleteideas.net/IncIdeas/BitterLesson.html'],
  ['How to Do Great Work', 'https://paulgraham.com/greatwork.html'],
  ['为什么我们收藏了却从不阅读', `${base}/a/why-we-save`],
  ['注意力是有预算的', `${base}/a/attention-budget`],
  ['论「读完」这件事', `${base}/a/finishing`],
  ['一个很短的测试页面', `${base}/a/short`],
  ['What Is ChatGPT Doing?', 'https://writings.stephenwolfram.com/2023/02/what-is-chatgpt-doing-and-why-does-it-work/'],
  ['Chrome 扩展 MV3 迁移指南', 'https://developer.chrome.com/docs/extensions/develop/migrate'],
  ['Chrome Bookmarks API', 'https://developer.chrome.com/docs/extensions/reference/api/bookmarks'],
  ['深入理解 Shadow DOM', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Web_components/Using_shadow_DOM'],
  ['CSS 容器查询', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_containment/Container_queries'],
  ['SQLite 是如何测试的', 'https://www.sqlite.org/testing.html'],
  ['昨天刚存的一篇', 'https://news.ycombinator.com/'],
];

const seeded = await browser.evaluate(
  `(async () => {
    const [root] = await chrome.bookmarks.getTree();
    const bar = root.children.find((n) => !n.url);
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: '待读' });
    const samples = ${JSON.stringify(SAMPLES)};
    for (const [title, url] of samples) {
      await chrome.bookmarks.create({ parentId: folder.id, title, url });
    }
    await chrome.storage.local.set({
      config: {
        folderId: folder.id,
        batchSize: 5,
        strategy: 'random',
        archiveFolderName: '已读归档',
      },
    });
    return { folderId: folder.id, count: samples.length };
  })()`,
  sessionId,
);

await browser.send('Page.reload', {}, sessionId);
await browser.waitForText(sessionId, (t) => t.includes('准备好开始了') || t.includes('已读'));

// The install-time options page also opens; bring the reading list to the front.
await browser.send('Target.activateTarget', { targetId });

browser.close();

console.log(`
──────────────────────────────────────────────────────────────
  试用环境已就绪（独立临时配置，不影响你日常的 Chrome）

  已预置「待读」文件夹，共 ${seeded.count} 篇文章
  每批 5 篇 · 随机选文 · 数据全部留在本地

  建议按这个顺序试：

  1. 点扩展工具栏图标（或已打开的标签）进入阅读清单
  2. 点「抽取 5 篇」 —— 看清单被锁定
  3. 点「重选（今日剩 1 次）」 —— 今天的整批重选额度被用掉
  4. 点「打开」 —— 应直接打开原网页，不注入或改写正文
  5. 点「已读」 —— 自动归档并刷新清单
  6. 点一次「放弃」 —— 只进入确认态；再次点击才真正删除
  7. 全部处理完后 —— 解锁并可抽下一批
  8. 打开 chrome://bookmarks 确认已读文章进入「已读归档」

  直接关闭那个 Chrome 窗口即可结束，临时配置会自动清理。
──────────────────────────────────────────────────────────────
`);

/**
 * On Windows the launcher process hands off to the real browser and exits
 * immediately, so watching the child process is not a reliable "browser closed"
 * signal. Poll the DevTools endpoint instead — it disappears with the browser.
 */
async function browserIsAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

let stop = false;
process.once('SIGINT', () => {
  stop = true;
});

while (!stop) {
  await sleep(2000);
  if (!(await browserIsAlive())) break;
}

console.log('浏览器已关闭，正在清理临时配置…');
await chrome.dispose();
process.exit(0);
