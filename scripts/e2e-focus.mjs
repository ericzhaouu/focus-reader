/**
 * End-to-end check of focus reading mode against the real shipped bundle.
 *
 * Chrome's optional-permission prompt cannot be answered in headless mode, so
 * rather than driving `chrome.permissions.request` this test loads the actual
 * built `dist/focus-inject.js` into a real page with a stubbed extension
 * messaging bridge. Everything that matters is still the real artifact:
 * Readability extraction, DOMPurify sanitising, Shadow DOM isolation, the
 * toolbar wiring and the preference controls.
 *
 * Run with: npm run e2e:focus
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, createReporter, findChrome, freePort, launchChrome, sleep, waitForEndpoint } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'dist', 'focus-inject.js');

if (!findChrome()) {
  console.log('未找到 Chrome，跳过专注模式端到端测试。');
  process.exit(0);
}
if (!existsSync(BUNDLE)) {
  throw new Error('dist/focus-inject.js 不存在，请先运行 npm run build');
}

const injectSource = readFileSync(BUNDLE, 'utf8');

const PARAGRAPH =
  '收藏一篇文章的那一刻，大脑会误以为自己已经读完了它。这种错觉几乎不需要成本，只要按下快捷键，一种「我已经掌握了这个知识」的满足感就会立刻兑现。于是收藏夹越来越长，真正读过的却寥寥无几。要打破这个循环，关键不在于收藏得更整齐，而在于限制一次能看到多少。当清单里只有固定的几篇，选择的负担消失了，剩下的只有读或不读。';

const ARTICLE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>为什么我们收藏了却不读 - 测试站点</title>
    <style>
      body { font-family: serif; background: #222; color: #eee; }
      /* A hostile site style that must not leak into the reader view. */
      div { border: 8px dashed magenta !important; }
      h1 { font-size: 9px !important; }
    </style>
  </head>
  <body>
    <nav id="site-nav"><a href="/">首页</a><a href="/about">关于</a></nav>
    <aside class="sidebar"><h3>推荐阅读</h3><ul><li>广告位一</li><li>广告位二</li></ul></aside>
    <article>
      <h1>为什么我们收藏了却不读</h1>
      <p class="byline">作者：测试作者</p>
      ${Array.from({ length: 6 }, () => `<p>${PARAGRAPH}</p>`).join('\n      ')}
      <h2>一个小节标题</h2>
      <p>${PARAGRAPH}</p>
      <blockquote>引用一段话，用来验证排版样式是否被正确应用。</blockquote>
      <pre><code>const batch = draw(10);</code></pre>
      <img src="/hero.png" alt="示意图" />
      <p>外部链接：<a href="https://example.com/other">另一篇文章</a></p>
      <script>window.__siteScriptRan = true;</script>
    </article>
    <footer>版权所有 © 测试站点</footer>
  </body>
</html>`;

const SHORT_HTML = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>一个视频页</title></head>
  <body><h1>视频标题</h1><p>这是一个几乎没有正文的页面。</p></body>
</html>`;

/** Fake extension bridge so the real bundle can run outside a content-script context. */
function bridgeStub(context) {
  return `
    window.__sent = [];
    window.chrome = {
      runtime: {
        sendMessage: (message) => {
          window.__sent.push(message);
          if (message.type === 'GET_FOCUS_CONTEXT') return Promise.resolve(${JSON.stringify(context)});
          return Promise.resolve({ ok: true });
        },
      },
    };
  `;
}

const CONTEXT = {
  bookmarkId: 'bm-42',
  url: 'https://test.example.com/why-we-save',
  enabled: true,
  prefs: {
    fontSize: 19,
    lineHeight: 1.75,
    contentWidth: 720,
    theme: 'light',
    disabledDomains: [],
  },
};

const reporter = createReporter();
const { check } = reporter;
const PORT = await freePort();
const chrome = launchChrome({ port: PORT });

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${PORT}/json/version`);
  console.log(`  ${version.Browser}\n`);
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);

  /** Opens a blank page, writes the given HTML, stubs the bridge, runs the bundle. */
  const runInjection = async (html, context) => {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Page.setDocumentContent', {
      frameId: targetId,
      html,
    }, sessionId);
    await browser.evaluate(bridgeStub(context), sessionId);
    await browser.evaluate(injectSource, sessionId);
    return sessionId;
  };

  // ---- happy path -------------------------------------------------------
  const session = await runInjection(ARTICLE_HTML, CONTEXT);

  const mounted = await browser.waitFor(
    session,
    `!!document.getElementById('__focus_reader_root__')?.shadowRoot?.querySelector('.wrap')`,
    (value) => value === true,
  );
  check('真实构建产物成功注入并挂载阅读视图', () => assert.equal(mounted, true));

  const probe = (expression) =>
    browser.evaluate(
      `(() => {
        const shadow = document.getElementById('__focus_reader_root__').shadowRoot;
        return ${expression};
      })()`,
      session,
    );

  const title = await probe(`shadow.querySelector('.article__title').textContent`);
  check('正文标题被正确提取，站点名后缀被剥离', () =>
    assert.equal(title, '为什么我们收藏了却不读'),
  );

  const bodyText = await probe(`shadow.querySelector('.content').innerText`);
  check('正文内容被提取，导航/侧栏/页脚等噪音被剥离', () => {
    assert.match(bodyText, /收藏一篇文章的那一刻/);
    assert.match(bodyText, /一个小节标题/);
    assert.doesNotMatch(bodyText, /广告位/);
    assert.doesNotMatch(bodyText, /版权所有/);
  });

  const sanitised = await probe(`({
    scripts: shadow.querySelectorAll('script').length,
    inlineStyles: shadow.querySelectorAll('.content [style]').length,
    siteScriptRan: !!window.__siteScriptRan,
  })`);
  check('提取内容经过净化：无脚本、无内联样式', () => {
    assert.equal(sanitised.scripts, 0);
    assert.equal(sanitised.inlineStyles, 0);
  });

  const isolation = await probe(`(() => {
    const wrap = shadow.querySelector('.wrap');
    const heading = shadow.querySelector('.article__title');
    return {
      mode: document.getElementById('__focus_reader_root__').shadowRoot.mode,
      wrapBorder: getComputedStyle(wrap).borderStyle,
      headingSize: parseFloat(getComputedStyle(heading).fontSize),
      sheets: shadow.adoptedStyleSheets.length,
    };
  })()`);
  check('Shadow DOM 隔离生效，站点的恶意样式没有渗入', () => {
    assert.equal(isolation.mode, 'open');
    assert.equal(isolation.sheets, 1, '样式应通过 adoptedStyleSheets 挂载');
    assert.notEqual(isolation.wrapBorder, 'dashed', '站点的 magenta 虚线边框不应生效');
    assert.ok(isolation.headingSize > 20, `标题字号应由阅读视图控制，实际 ${isolation.headingSize}px`);
  });

  const links = await probe(`(() => {
    const anchors = [...shadow.querySelectorAll('.content a[href]')];
    return { total: anchors.length, safe: anchors.filter((a) => a.target === '_blank' && a.rel.includes('noopener')).length };
  })()`);
  check('正文链接均以安全方式在新标签页打开', () => {
    assert.ok(links.total > 0);
    assert.equal(links.safe, links.total);
  });

  const pageLocked = await browser.evaluate(
    `getComputedStyle(document.documentElement).overflow`,
    session,
  );
  check('进入专注模式后底层页面滚动被锁定', () => assert.equal(pageLocked, 'hidden'));

  // ---- preference controls ---------------------------------------------
  await probe(`shadow.querySelector('[data-act="prefs"]').click()`);
  const panelOpen = await probe(`!shadow.querySelector('[data-el="panel"]').hidden`);
  check('阅读设置面板可以打开', () => assert.equal(panelOpen, true));

  await probe(`shadow.querySelector('[data-step="fontSize:1"]').click()`);
  const fontAfter = await probe(
    `shadow.querySelector('.wrap').style.getPropertyValue('--fr-font-size')`,
  );
  check('调节字号立即生效', () => assert.equal(fontAfter, '20px'));

  await probe(`shadow.querySelector('button[data-theme="dark"]').click()`);
  const themed = await probe(`({
    theme: shadow.querySelector('.wrap').dataset.theme,
    pressed: shadow.querySelector('button[data-theme="dark"]').getAttribute('aria-pressed'),
    others: [...shadow.querySelectorAll('button[data-theme]')]
      .filter((b) => b.dataset.theme !== 'dark')
      .map((b) => b.getAttribute('aria-pressed')),
  })`);
  check('切换深色主题生效并更新按钮状态', () => {
    assert.equal(themed.theme, 'dark');
    assert.equal(themed.pressed, 'true');
    assert.deepEqual(themed.others, ['false', 'false'], '其余主题按钮应取消选中');
  });

  const persisted = await browser.evaluate(
    `window.__sent.filter((m) => m.type === 'SAVE_FOCUS_PREFS').map((m) => m.patch)`,
    session,
  );
  check('偏好变更会被持久化', () => {
    assert.deepEqual(persisted, [{ fontSize: 20 }, { theme: 'dark' }]);
  });

  // ---- exit to original page -------------------------------------------
  await probe(`shadow.querySelector('[data-act="original"]').click()`);
  const exited = await browser.evaluate(
    `(() => {
      const host = document.getElementById('__focus_reader_root__');
      const shadow = host.shadowRoot;
      return {
        wrapHidden: shadow.querySelector('.wrap').style.display === 'none',
        hintShown: !shadow.querySelector('[data-el="hint"]').hidden,
        pageOverflow: getComputedStyle(document.documentElement).overflow,
      };
    })()`,
    session,
  );
  check('点「看原页」后退出阅读视图并恢复页面滚动', () => {
    assert.equal(exited.wrapHidden, true);
    assert.equal(exited.hintShown, true);
    assert.notEqual(exited.pageOverflow, 'hidden');
  });

  await probe(`shadow.querySelector('[data-act="hint-restore"]').click()`);
  const restored = await probe(`shadow.querySelector('.wrap').style.display !== 'none'`);
  check('可以从提示条重新回到专注模式', () => assert.equal(restored, true));

  // ---- mark as read closes the loop -------------------------------------
  await probe(`shadow.querySelector('[data-act="read"]').click()`);
  await sleep(400);
  const loop = await browser.evaluate(`window.__sent.map((m) => m.type)`, session);
  check('点「标记已读」会归档并请求关闭标签页回到清单', () => {
    assert.ok(loop.includes('MARK_READ'), '应发出 MARK_READ');
    assert.ok(loop.includes('CLOSE_AND_RETURN'), '应发出 CLOSE_AND_RETURN');
    assert.ok(
      loop.indexOf('MARK_READ') < loop.indexOf('CLOSE_AND_RETURN'),
      '必须先归档再关闭，否则会丢失已读记录',
    );
  });

  const markPayload = await browser.evaluate(
    `window.__sent.find((m) => m.type === 'MARK_READ')`,
    session,
  );
  check('归档请求携带正确的书签 ID', () => assert.equal(markPayload.bookmarkId, 'bm-42'));

  // ---- graceful degradation ---------------------------------------------
  const shortSession = await runInjection(SHORT_HTML, CONTEXT);
  await sleep(1200);
  const skipped = await browser.evaluate(
    `!document.getElementById('__focus_reader_root__')`,
    shortSession,
  );
  check('正文过短的页面自动降级，保留原页而不是渲染空白', () => assert.equal(skipped, true));

  const disabledSession = await runInjection(ARTICLE_HTML, { ...CONTEXT, enabled: false });
  await sleep(1200);
  const notInjected = await browser.evaluate(
    `!document.getElementById('__focus_reader_root__')`,
    disabledSession,
  );
  check('专注模式关闭或站点被禁用时不注入', () => assert.equal(notInjected, true));

  browser.close();
} finally {
  await chrome.dispose();
}

console.log(
  `\n${reporter.failures === 0 ? '专注模式 e2e 全部通过' : `${reporter.failures} 项失败`}`,
);
process.exit(reporter.failures === 0 ? 0 : 1);
