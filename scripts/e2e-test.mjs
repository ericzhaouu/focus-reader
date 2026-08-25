/**
 * End-to-end check of the reading queue against a real Chrome with the unpacked
 * extension installed. Verifies what the unit-level smoke test cannot: that the
 * manifest is accepted, the service worker boots on demand, and the reader page
 * renders and locks a real batch drawn from real Chrome bookmarks.
 *
 * Run with: npm run e2e
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Cdp,
  createReporter,
  findChrome,
  freePort,
  launchChrome,
  sleep,
  waitForEndpoint,
} from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

if (!findChrome()) {
  console.log('未找到 Chrome，跳过端到端测试。');
  process.exit(0);
}
if (!existsSync(join(DIST, 'manifest.json'))) {
  throw new Error('dist/manifest.json 不存在，请先运行 npm run build');
}

const reporter = createReporter();
const { check } = reporter;
const articleServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body><h1>E2E 原网页</h1><p>由来源网站直接渲染。</p></body></html>');
});
await new Promise((resolve) => articleServer.listen(0, '127.0.0.1', resolve));
const articlePort = articleServer.address().port;
const PORT = await freePort();
const chrome = launchChrome({ port: PORT, extraArgs: ['--lang=en-US'] });

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${PORT}/json/version`);
  console.log(`  ${version.Browser}`);

  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const { id: extensionId } = await browser.send('Extensions.loadUnpacked', { path: DIST });
  check('Chrome 接受该扩展并完成安装', () => assert.match(extensionId, /^[a-p]{32}$/));
  console.log(`  扩展 ID：${extensionId}\n`);

  const openPage = async (path) => {
    const { targetId } = await browser.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/${path}`,
    });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    return { targetId, sessionId };
  };

  const reader = await openPage('reader.html');
  const loadedOk = await browser.waitForText(reader.sessionId, (t) => t.includes('Reading Queue'));
  check('阅读页成功加载（扩展页面与 React 均正常）', () =>
    assert.match(loadedOk, /Reading Queue/),
  );
  const localeInfo = await browser.evaluate(
    `({
       locale: chrome.i18n.getUILanguage(),
       name: chrome.i18n.getMessage('extensionName'),
       dynamic: chrome.i18n.getMessage('readerReadyText', ['12', '5'])
     })`,
    reader.sessionId,
  );
  check('默认英文词库和动态占位符正常', () => {
    assert.match(localeInfo.locale, /^en/i);
    assert.equal(localeInfo.name, 'Focus Reader');
    assert.equal(
      localeInfo.dynamic,
      '12 articles are waiting. Drawing a batch will lock 5 until it is finished.',
    );
  });
  const manifest = await browser.evaluate('chrome.runtime.getManifest()', reader.sessionId);
  check('扩展只申请 bookmarks 与 storage 权限', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['bookmarks', 'storage']);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.optional_host_permissions, undefined);
  });

  // Seed real Chrome bookmarks from inside the extension page, which has full API access.
  const folderId = await browser.evaluate(
    `(async () => {
      const [root] = await chrome.bookmarks.getTree();
      const bar = root.children.find((n) => !n.url);
      const folder = await chrome.bookmarks.create({ parentId: bar.id, title: 'E2E Reading' });
      for (let i = 1; i <= 12; i++) {
        await chrome.bookmarks.create({
           parentId: folder.id,
           title: 'E2E Article ' + i,
           url: 'http://127.0.0.1:${articlePort}/post-' + i,
        });
      }
      await chrome.storage.local.set({
        config: {
          folderId: folder.id,
          batchSize: 5,
          strategy: 'random',
          archiveFolderName: 'Read Archive',
        },
      });
      return folder.id;
    })()`,
    reader.sessionId,
  );
  check('通过扩展写入真实书签与配置', () => assert.ok(folderId));

  await browser.send('Page.reload', {}, reader.sessionId);

  const ready = await browser.waitForText(reader.sessionId, (t) => t.includes('Ready to begin'));
  check('识别出待读文件夹并显示可抽取数量', () => {
    assert.match(ready, /Ready to begin/);
    assert.match(ready, /12 articles are waiting/);
    assert.match(ready, /Draw 5/);
  });

  await browser.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Draw')).click()`,
    reader.sessionId,
  );

  const drawn = await browser.waitForText(reader.sessionId, (t) => t.includes('E2E Article'));
  const cardCount = await browser.evaluate(
    'document.querySelectorAll(".card").length',
    reader.sessionId,
  );
  check('抽取后渲染出锁定的 5 篇清单', () => {
    assert.equal(cardCount, 5);
    assert.match(drawn, /0\s*\/\s*5 read/);
    assert.match(drawn, /5 left/);
  });
  check('页面上不存在任何「新增文章」入口', () => assert.doesNotMatch(drawn, /Add article/));
  check('重选按钮显示每日额度', () => assert.match(drawn, /Reroll \(1 left today\)/));
  check('每张卡片都提供「放弃」出口', () => {
    assert.equal(cardCount, 5);
  });
  const abandonButtons = await browser.evaluate(
    `[...document.querySelectorAll('.card button')].filter((b) => b.textContent === 'Abandon').length`,
    reader.sessionId,
  );
  check('放弃按钮数量与未读文章数一致', () => assert.equal(abandonButtons, 5));

  const sourceUrl = await browser.evaluate(
    `(async () => {
       const { currentBatch } = await chrome.storage.local.get('currentBatch');
       return currentBatch.items[0].url;
     })()`,
    reader.sessionId,
  );
  await browser.evaluate(
    `[...document.querySelectorAll('.card button')].find((b) => b.textContent === 'Open').click()`,
    reader.sessionId,
  );
  let sourceTarget = null;
  for (let attempt = 0; attempt < 50 && !sourceTarget; attempt++) {
    const { targetInfos } = await browser.send('Target.getTargets');
    sourceTarget = targetInfos.find((target) => target.type === 'page' && target.url === sourceUrl);
    if (!sourceTarget) await sleep(100);
  }
  check('打开文章会导航到书签原网址', () => assert.ok(sourceTarget));
  if (sourceTarget) {
    const { sessionId: sourceSession } = await browser.send(
      'Target.attachToTarget',
      { targetId: sourceTarget.targetId, flatten: true },
    );
    const sourceText = await browser.waitForText(sourceSession, (text) => text.includes('E2E 原网页'));
    const injectionRoot = await browser.evaluate(
      `!!document.getElementById('__focus_reader_root__')`,
      sourceSession,
    );
    check('原网页由来源网站直接渲染且没有注入阅读视图', () => {
      assert.match(sourceText, /由来源网站直接渲染/);
      assert.equal(injectionRoot, false);
    });
    await browser.send('Target.closeTarget', { targetId: sourceTarget.targetId });
  }

  await browser.evaluate(
    `[...document.querySelectorAll('.card button')].find((b) => b.textContent === 'Read').click()`,
    reader.sessionId,
  );

  const afterRead = await browser.waitForText(reader.sessionId, (t) => /1\s*\/\s*5 read/.test(t));
  check('标记已读后进度推进，且不能再整批重选', () => {
    assert.match(afterRead, /1\s*\/\s*5 read/);
    assert.match(afterRead, /Started · reroll locked/);
    assert.match(afterRead, /4 left/);
  });

  const archived = await browser.evaluate(
    `(async () => {
      const { config } = await chrome.storage.local.get('config');
      const children = await chrome.bookmarks.getChildren(config.folderId);
      const archive = children.find((n) => !n.url && n.title === 'Read Archive');
      if (!archive) return { archiveExists: false };
      const inside = await chrome.bookmarks.getChildren(archive.id);
      return {
        archiveExists: true,
        archivedCount: inside.length,
        remaining: children.filter((n) => n.url).length,
        freshlyDated: inside.every((n) => Date.now() - n.dateAdded < 120000),
      };
    })()`,
    reader.sessionId,
  );
  check('已读文章进入归档子文件夹，且收藏时间刷新为今天', () => {
    assert.equal(archived.archiveExists, true);
    assert.equal(archived.archivedCount, 1);
    assert.equal(archived.remaining, 11);
    assert.equal(archived.freshlyDated, true);
  });

  // Abandoning deletes the bookmark, so it deliberately takes two clicks.
  await browser.evaluate(
    `[...document.querySelectorAll('.card button')].find((b) => b.textContent === 'Abandon').click()`,
    reader.sessionId,
  );
  const armed = await browser.waitFor(
    reader.sessionId,
    `[...document.querySelectorAll('.card button')].some((b) => b.textContent === 'Confirm abandon?')`,
    (v) => v === true,
    5000,
  );
  const stillThere = await browser.evaluate(
    `(async () => {
      const { config } = await chrome.storage.local.get('config');
      return (await chrome.bookmarks.getChildren(config.folderId)).filter(n => n.url).length;
    })()`,
    reader.sessionId,
  );
  check('「放弃」第一次点击只进入确认态，不删除任何东西', () => {
    assert.equal(armed, true);
    assert.equal(stillThere, 11, '首次点击不应删除书签');
  });

  await browser.evaluate(
    `[...document.querySelectorAll('.card button')].find((b) => b.textContent === 'Confirm abandon?').click()`,
    reader.sessionId,
  );
  await browser.waitForText(reader.sessionId, (t) => t.includes('Abandoned'));

  const abandoned = await browser.evaluate(
    `(async () => {
      const { config, currentBatch, stats } = await chrome.storage.local.get(['config','currentBatch','stats']);
      const children = await chrome.bookmarks.getChildren(config.folderId);
      const archive = children.find((n) => !n.url && n.title === 'Read Archive');
      return {
        pending: children.filter(n => n.url).length,
        archived: archive ? (await chrome.bookmarks.getChildren(archive.id)).length : 0,
        abandonedInBatch: currentBatch.items.filter(i => i.status === 'abandoned').length,
        totalAbandoned: stats.totalAbandoned,
        totalRead: stats.totalRead,
        totalWords: stats.totalWords,
      };
    })()`,
    reader.sessionId,
  );
  check('确认后书签被真正删除，不进归档也不计入已读', () => {
    assert.equal(abandoned.pending, 10, '待读应从 11 减到 10');
    assert.equal(abandoned.archived, 1, '放弃的文章不应进归档');
    assert.equal(abandoned.abandonedInBatch, 1);
    assert.equal(abandoned.totalAbandoned, 1);
    assert.equal(abandoned.totalRead, 1);
  });

  const arcade = await browser.evaluate(
    `(() => {
       const panel = document.querySelector('.arcade');
       if (!panel) return null;
       return {
         stage: panel.querySelector('.arcade__stage')?.textContent ?? '',
         score: panel.querySelector('.arcade__score')?.textContent ?? '',
         slots: panel.querySelectorAll('.arcade__spine').length,
         segments: panel.querySelectorAll('.arcade__seg').length,
         lit: panel.querySelectorAll('.arcade__seg--on').length,
         text: panel.innerText,
       };
     })()`,
    reader.sessionId,
  );
  check('阅读进度以街机面板呈现', () => {
    assert.ok(arcade, '应渲染 .arcade 面板');
    assert.match(arcade.stage, /STAGE \d\d/);
    assert.match(arcade.score, /^\d{7}$/, '分数应为 7 位补零');
    assert.equal(arcade.slots, 17, '书架应列出全部里程碑槽位');
    assert.equal(arcade.segments, 24, '能量槽应为分段式');
  });
  check('读完一篇后进度条开始填充', () => {
    assert.ok(abandoned.totalWords > 0, '读完一篇后应累计字数');
    assert.ok(arcade.lit > 0, '能量槽应至少点亮一格');
    assert.match(arcade.text, /unlock/);
  });

  // The lock is the product: the batch must stay pinned while items remain unread.
  const state = await browser.evaluate(
    `(async () => {
      const { currentBatch } = await chrome.storage.local.get('currentBatch');
      return {
        size: currentBatch.items.length,
        unread: currentBatch.items.filter((i) => i.status === 'unread').length,
      };
    })()`,
    reader.sessionId,
  );
  check('批次仍处于锁定状态，剩余 3 篇未读', () => {
    assert.equal(state.size, 5);
    assert.equal(state.unread, 3, '已读 1 篇、放弃 1 篇后应剩 3 篇');
  });

  const optionsPage = await openPage('options.html');
  const optionsText = await browser.waitForText(optionsPage.sessionId, (t) =>
    t.includes('Focus Reader Settings'),
  );
  const strategyOptions = await browser.evaluate(
    `[...document.querySelectorAll('#strategy option')].map((o) => o.textContent.trim())`,
    optionsPage.sessionId,
  );
  check('设置页正常渲染并列出书签文件夹', () => {
    assert.match(optionsText, /Reading folder/);
    assert.match(optionsText, /E2E Reading/);
    assert.doesNotMatch(optionsText, /Focus mode/);
  });
  check('选文下拉只列出已实现的策略', () => {
    assert.deepEqual(strategyOptions, ['Random', 'Oldest first', 'Source diversity', 'Balanced length']);
    assert.doesNotMatch(optionsText, /Coming soon/);
  });

  browser.close();
} finally {
  await chrome.dispose();
  await new Promise((resolve) => articleServer.close(resolve));
}

console.log(`\n${reporter.failures === 0 ? '阅读清单 e2e 全部通过' : `${reporter.failures} 项失败`}`);
process.exit(reporter.failures === 0 ? 0 : 1);
