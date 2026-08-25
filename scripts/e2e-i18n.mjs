/** Verifies Chrome selects the Simplified Chinese catalog end to end. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Cdp,
  createReporter,
  findChrome,
  freePort,
  launchChrome,
  waitForEndpoint,
} from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

if (!findChrome()) {
  console.log('未找到 Chrome，跳过中文本地化测试。');
  process.exit(0);
}
if (!existsSync(join(DIST, 'manifest.json'))) {
  throw new Error('dist/manifest.json 不存在，请先运行 npm run build');
}

const reporter = createReporter();
const { check } = reporter;
const port = await freePort();
const chrome = launchChrome({ port, extraArgs: ['--lang=zh-CN'] });

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`);
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const { id } = await browser.send('Extensions.loadUnpacked', { path: DIST });

  const openPage = async (path) => {
    const { targetId } = await browser.send('Target.createTarget', {
      url: `chrome-extension://${id}/${path}`,
    });
    const { sessionId } = await browser.send(
      'Target.attachToTarget',
      { targetId, flatten: true },
    );
    return sessionId;
  };

  const reader = await openPage('reader.html');
  const text = await browser.waitForText(reader, (value) => value.includes('先选一个待读文件夹'));
  const info = await browser.evaluate(
    `({
       locale: chrome.i18n.getUILanguage(),
       manifestName: chrome.runtime.getManifest().name,
       action: chrome.i18n.getMessage('actionTitle'),
       dynamic: chrome.i18n.getMessage('readerReadyText', ['12', '5']),
       title: document.title,
       lang: document.documentElement.lang
     })`,
    reader,
  );

  check('Chrome 选择 zh_CN 词库', () => assert.match(info.locale, /^zh/i));
  check('manifest 名称和操作标题为中文', () => {
    assert.equal(info.manifestName, 'Focus Reader — 读完再存');
    assert.equal(info.action, '打开阅读清单');
  });
  check('动态占位符按中文顺序渲染', () => {
    assert.equal(
      info.dynamic,
      '待读文件夹里有 12 篇文章。抽取后会锁定 5 篇，处理完才能抽下一批。',
    );
  });
  check('页面标题、lang 和引导内容为中文', () => {
    assert.equal(info.title, '阅读清单');
    assert.match(info.lang, /^zh/i);
    assert.match(text, /收藏夹里存放待读文章/);
  });

  const options = await openPage('options.html');
  const optionsText = await browser.waitForText(options, (value) =>
    value.includes('Focus Reader 设置'),
  );
  check('设置页为中文', () => {
    assert.match(optionsText, /待读文件夹/);
    assert.match(optionsText, /每批篇数/);
    assert.match(optionsText, /选文方式/);
  });

  browser.close();
} finally {
  await chrome.dispose();
}

console.log(
  `\n${reporter.failures === 0 ? '中文本地化 e2e 全部通过' : `${reporter.failures} 项失败`}`,
);
process.exit(reporter.failures === 0 ? 0 : 1);
