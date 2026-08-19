/**
 * Verifies focus mode recovers documents that virtualise their content.
 *
 * Feishu/Lark docx, Notion and similar editors keep only the visible blocks in
 * the DOM. Readability copes fine with their non-semantic markup — measured at
 * 98% on a fully rendered fixture — but on a virtualised one it extracts a
 * fraction of the document and produces a reader view that looks complete and is
 * not. Silently losing most of an article is worse than declining to render it.
 *
 * This fixture is a real virtualiser: it mounts and unmounts blocks on scroll,
 * as Feishu's renderer does. Without the collection pass only ~13% of the
 * document is reachable; with it, all of it should be.
 *
 * Run with: npm run e2e:virtual
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, findChrome, freePort, launchChrome, sleep, waitForEndpoint } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const injectSource = readFileSync(join(ROOT, 'dist', 'focus-inject.js'), 'utf8');

const TOTAL_BLOCKS = 80;
const BLOCK_HEIGHT = 90;
const VIEWPORT = 700;

const SENTENCES = [
  '协作文档的价值不在于把字写下来，而在于让一群人对同一件事形成共识。',
  '大多数团队的文档之所以没人看，是因为它记录的是结论，而不是推导过程。',
  '一份好的设计文档应该让读者能够复现作者的思路，而不只是接受作者的判断。',
  '当我们说某个方案更好时，通常省略了约束条件，而约束条件才是真正的信息。',
  '写文档最难的部分不是组织语言，是承认自己其实还没想清楚。',
];

/**
 * Mimics Feishu's docx renderer: a fixed-height scroll container, a spacer that
 * gives it the full document height, and only the blocks near the viewport
 * actually present in the DOM.
 */
const FIXTURE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>协作文档的价值 - 飞书云文档</title>
<style>
  body { margin: 0; font-family: system-ui; }
  #scroller { height: ${VIEWPORT}px; overflow-y: auto; position: relative; }
  #spacer { position: relative; }
  .block { position: absolute; left: 0; right: 0; height: ${BLOCK_HEIGHT}px; padding: 8px 24px; box-sizing: border-box; }
</style></head><body>
<div class="docx-title"><div class="ace-line"><span data-string="true">协作文档的价值</span></div></div>
<div id="scroller"><div id="spacer"></div></div>
<script>
  const TOTAL = ${TOTAL_BLOCKS}, H = ${BLOCK_HEIGHT};
  const S = ${JSON.stringify(SENTENCES)};
  const scroller = document.getElementById('scroller');
  const spacer = document.getElementById('spacer');
  spacer.style.height = (TOTAL * H) + 'px';
  window.__mountedEver = new Set();

  function render() {
    const top = scroller.scrollTop;
    const first = Math.max(0, Math.floor(top / H) - 1);
    const last = Math.min(TOTAL - 1, Math.ceil((top + ${VIEWPORT}) / H) + 1);
    // Unmount everything outside the window, exactly as a virtualiser would.
    for (const el of [...spacer.children]) {
      const i = Number(el.dataset.index);
      if (i < first || i > last) el.remove();
    }
    for (let i = first; i <= last; i++) {
      if (spacer.querySelector('[data-index="' + i + '"]')) continue;
      const d = document.createElement('div');
      d.className = 'block';
      d.dataset.index = i;
      d.dataset.blockId = 'blk' + i;
      d.style.top = (i * H) + 'px';
      const t = '第' + (i + 1) + '段。' + S[i % S.length];
      d.innerHTML = '<div class="docx-text-block"><div class="ace-line">' +
        '<span data-string="true">' + t + '</span></div></div>';
      spacer.appendChild(d);
      window.__mountedEver.add(i);
    }
  }
  scroller.addEventListener('scroll', render);
  render();
</script></body></html>`;

if (!findChrome()) {
  console.error('未找到 Chrome。');
  process.exit(1);
}

const port = await freePort();
const chrome = launchChrome({ port, extraArgs: [`--window-size=1280,900`] });

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`);
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Page.setDocumentContent', { frameId: targetId, html: FIXTURE }, sessionId);
  await sleep(600);

  const baseline = await browser.evaluate(
    `({
       blocksInDom: document.querySelectorAll('.block').length,
       total: ${TOTAL_BLOCKS},
       textLen: document.body.innerText.replace(/\\s+/g,'').length,
     })`,
    sessionId,
  );
  console.log(`\n■ 初始状态（未滚动）`);
  console.log(`   DOM 中 ${baseline.blocksInDom} / ${baseline.total} 块 —— 只有 ${((baseline.blocksInDom / baseline.total) * 100).toFixed(0)}% 在 DOM 里`);
  console.log(`   任何此刻的提取都会静默丢掉 ${baseline.total - baseline.blocksInDom} 块内容`);

  // Run the real shipped bundle and see how much of the document it recovers.
  await browser.evaluate(
    `window.chrome = { runtime: { sendMessage: (m) => Promise.resolve(
       m.type === 'GET_FOCUS_CONTEXT'
         ? { bookmarkId: 'p', url: location.href, enabled: true,
             prefs: { fontSize: 19, lineHeight: 1.75, contentWidth: 720, theme: 'light', disabledDomains: [] } }
         : { ok: true }) } }; 'ok'`,
    sessionId,
  );
  await browser.evaluate(injectSource, sessionId);

  const mounted = await browser.waitFor(
    sessionId,
    `!!document.getElementById('__focus_reader_root__')?.shadowRoot?.querySelector('.content')`,
    (v) => v === true,
    15000,
  );

  console.log(`\n■ 真实构建产物 focus-inject.js`);
  let failed = false;
  if (mounted !== true) {
    console.log('   ✗ 未挂载阅读视图');
    failed = true;
  } else {
    const result = await browser.evaluate(
      `(() => {
         const shadow = document.getElementById('__focus_reader_root__').shadowRoot;
         const text = shadow.querySelector('.content').innerText;
         const compact = text.replace(/\\s+/g, '');
         return {
           chars: compact.length,
           hasFirst: text.includes('第1段'),
           hasMiddle: text.includes('第40段'),
           hasLast: text.includes('第80段'),
           segmentsFound: (text.match(/第\\d+段/g) || []).length,
           title: shadow.querySelector('.article__title').textContent,
         };
       })()`,
      sessionId,
    );
    console.log(`   标题: ${JSON.stringify(result.title)}`);
    console.log(`   提取 ${result.chars} 字，识别出 ${result.segmentsFound} / ${TOTAL_BLOCKS} 段`);
    console.log(`   首段在: ${result.hasFirst}   中段在: ${result.hasMiddle}   末段在: ${result.hasLast}`);
    const complete =
      result.segmentsFound === TOTAL_BLOCKS && result.hasFirst && result.hasMiddle && result.hasLast;
    console.log(`   → ${complete ? '✅ 完整恢复整篇文档' : '⚠ 仍有缺失'}`);
    if (!complete) failed = true;
  }

  const after = await browser.evaluate(
    `document.querySelectorAll('.block').length`,
    sessionId,
  );
  console.log(`\n   结束后 DOM 中仍只有 ${after} 块（页面自身的虚拟化未被破坏）`);

  browser.close();

  if (failed) {
    console.error('\n虚拟滚动恢复未通过');
    process.exit(1);
  }
  console.log('\n虚拟滚动 e2e 通过');
} finally {
  await chrome.dispose();
}
