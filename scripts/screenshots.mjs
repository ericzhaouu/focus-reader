/**
 * Captures locale-specific Chrome Web Store screenshots at 1280x800.
 *
 * English is the extension's default locale. Simplified Chinese screenshots are
 * also generated for the localized Store listing and copied to store-assets/ root
 * for the Chinese README.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Cdp,
  findChrome,
  freePort,
  launchChrome,
  sleep,
  waitForEndpoint,
} from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'store-assets');
const WIDTH = 1280;
const HEIGHT = 800;
const filenames = ['1-reading-list.png', '2-settings.png', '3-milestone.png'];

if (!findChrome()) {
  console.error('未找到 Chrome。');
  process.exit(1);
}
if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json 不存在，请先运行 npm run build');
  process.exit(1);
}

function pageOpener(browser, require_) {
  return async (url) => {
    const { targetId } = await browser.send('Target.createTarget', { url });
    const { sessionId } = await browser.send(
      'Target.attachToTarget',
      { targetId, flatten: true },
    );
    await browser.send('Page.enable', {}, sessionId);
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
    await require_(
      sessionId,
      `document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(url)})`,
      `${url} 加载完成`,
    );
    return { targetId, sessionId };
  };
}

async function captureLocale(definition) {
  const output = join(OUT, definition.output);
  mkdirSync(output, { recursive: true });

  const port = await freePort();
  const chrome = launchChrome({
    port,
    extraArgs: [
      `--lang=${definition.chromeLanguage}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--hide-scrollbars',
    ],
  });

  try {
    const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`);
    const browser = await Cdp.connect(version.webSocketDebuggerUrl);
    const require_ = async (sessionId, expression, what, timeoutMs = 20_000) => {
      const value = await browser.waitFor(sessionId, expression, (v) => v === true, timeoutMs);
      if (value !== true) throw new Error(`${definition.output}: 等待超时：${what}`);
    };
    const openPage = pageOpener(browser, require_);
    const capture = async (sessionId, name, description) => {
      await sleep(500);
      const { data } = await browser.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false },
        sessionId,
      );
      writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'));
      console.log(`  ✓ ${definition.output}/${name}.png — ${description}`);
    };

    const { id } = await browser.send('Extensions.loadUnpacked', { path: DIST });
    const reader = await openPage(`chrome-extension://${id}/reader.html`);
    await require_(
      reader.sessionId,
      'typeof chrome !== "undefined" && !!chrome.bookmarks',
      'bookmarks API',
    );

    await browser.evaluate(
      `(async () => {
        const [root] = await chrome.bookmarks.getTree();
        const bar = root.children.find((n) => !n.url);
        const folder = await chrome.bookmarks.create({
          parentId: bar.id,
          title: ${JSON.stringify(definition.folderName)}
        });
        for (const [title, url] of ${JSON.stringify(definition.samples)}) {
          await chrome.bookmarks.create({ parentId: folder.id, title, url });
        }
        await chrome.storage.local.set({
          config: {
            folderId: folder.id,
            batchSize: 5,
            strategy: 'random',
            archiveFolderName: ${JSON.stringify(definition.archiveName)}
          },
          stats: {
            totalRead: 23,
            streakDays: 6,
            lastReadDate: new Date().toISOString().slice(0, 10),
            dailyCounts: {},
            batchesCompleted: 4,
            totalAbandoned: 5,
            totalWords: 118400,
            lastRerollDate: null
          }
        });
      })()`,
      reader.sessionId,
    );

    await browser.send('Page.reload', {}, reader.sessionId);
    await require_(
      reader.sessionId,
      `document.body.innerText.includes(${JSON.stringify(definition.readyText)})`,
      '阅读清单就绪',
    );
    await browser.evaluate(
      `[...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes(${JSON.stringify(definition.drawText)}))
        .click()`,
      reader.sessionId,
    );
    await require_(
      reader.sessionId,
      'document.querySelectorAll(".card").length === 5',
      '批次渲染',
    );
    await capture(reader.sessionId, '1-reading-list', definition.listDescription);

    await browser.evaluate(
      `document.querySelector('.arcade').scrollIntoView({ block: 'end' }); window.scrollBy(0, 60);`,
      reader.sessionId,
    );
    await capture(reader.sessionId, '3-milestone', definition.arcadeDescription);

    const options = await openPage(`chrome-extension://${id}/options.html`);
    await require_(
      options.sessionId,
      `document.body.innerText.includes(${JSON.stringify(definition.settingsText)})
        && document.body.innerText.includes(${JSON.stringify(definition.currentText)})`,
      '设置页渲染',
    );
    await capture(options.sessionId, '2-settings', definition.settingsDescription);
    browser.close();
  } finally {
    await chrome.dispose();
  }
}

const englishSamples = [
  ['How to Do Great Work', 'https://paulgraham.com/greatwork.html'],
  ['The Bitter Lesson', 'http://incompleteideas.net/IncIdeas/BitterLesson.html'],
  ['Understanding Shadow DOM', 'https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM'],
  ['Why We Save More Than We Read', 'https://example.com/slow-reading/why-we-save'],
  ['Attention Is a Budget', 'https://example.com/deep-reading/attention-budget'],
  ['How SQLite Is Tested', 'https://www.sqlite.org/testing.html'],
  ['On Finishing What You Save', 'https://example.com/paper/on-finishing'],
  ['The Attention Economy', 'https://en.wikipedia.org/wiki/Attention_economy'],
];

const chineseSamples = [
  ['How to Do Great Work', 'https://paulgraham.com/greatwork.html'],
  ['The Bitter Lesson', 'http://incompleteideas.net/IncIdeas/BitterLesson.html'],
  ['深入理解 Shadow DOM', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Web_components/Using_shadow_DOM'],
  ['为什么我们收藏了却从不阅读', 'https://example.com/slow-reading/why-we-save'],
  ['一篇存了很久的长文', 'https://en.wikipedia.org/wiki/Attention_economy'],
  ['注意力是有预算的', 'https://example.com/deep-reading/attention-budget'],
  ['SQLite 是如何测试的', 'https://www.sqlite.org/testing.html'],
  ['论「读完」这件事', 'https://example.com/paper/on-finishing'],
];

await captureLocale({
  output: 'en',
  chromeLanguage: 'en-US',
  folderName: 'Reading Queue',
  archiveName: 'Read Archive',
  samples: englishSamples,
  readyText: 'Ready to begin',
  drawText: 'Draw',
  settingsText: 'Focus Reader Settings',
  currentText: 'Current:',
  listDescription: 'Locked reading queue',
  arcadeDescription: 'Arcade reading progress',
  settingsDescription: 'Reading folder and batch settings',
});

await captureLocale({
  output: 'zh_CN',
  chromeLanguage: 'zh-CN',
  folderName: '待读',
  archiveName: '已读归档',
  samples: chineseSamples,
  readyText: '准备好开始了',
  drawText: '抽取',
  settingsText: 'Focus Reader 设置',
  currentText: '当前：',
  listDescription: '锁定的阅读清单',
  arcadeDescription: '街机风阅读进度',
  settingsDescription: '待读文件夹与批次设置',
});

for (const filename of filenames) {
  cpSync(join(OUT, 'zh_CN', filename), join(OUT, filename));
}

console.log(`
  English and Simplified Chinese screenshots generated in store-assets/en and store-assets/zh_CN.
  Simplified Chinese copies remain in store-assets/ for the README.
`);
