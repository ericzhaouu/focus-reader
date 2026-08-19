/**
 * Generates the store's small promo tile and optional marquee image.
 *
 * These are promotional graphics, not screenshots: the store recommends a simple,
 * branded composition rather than shrinking the product UI into an unreadable tile.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, findChrome, freePort, launchChrome, waitForEndpoint } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store-assets');
mkdirSync(OUT, { recursive: true });

if (!findChrome()) {
  console.error('未找到 Chrome。');
  process.exit(1);
}

function html(width, height) {
  const compact = width < 800;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{
  background:
    radial-gradient(110% 140% at 70% -20%,#27215b 0%,transparent 58%),
    linear-gradient(145deg,#080715,#11102a);
  color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
}
body::before{
  content:"";position:absolute;inset:0;opacity:.3;
  background:
    repeating-linear-gradient(to bottom,rgba(0,0,0,.22) 0 1px,transparent 1px 4px),
    linear-gradient(90deg,transparent 49.8%,rgba(52,230,242,.06) 50%,transparent 50.2%);
}
.frame{
  position:absolute;inset:${compact ? 16 : 32}px;
  border:2px solid #342d71;border-radius:${compact ? 18 : 26}px;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 0 48px rgba(52,230,242,.08);
  display:flex;align-items:center;padding:${compact ? '24px' : '56px 72px'};gap:${compact ? 22 : 52}px;
}
.icon{
  flex:none;width:${compact ? 88 : 164}px;height:${compact ? 88 : 164}px;border-radius:24%;
  background:linear-gradient(145deg,#6259f0,#4338ca);position:relative;
  box-shadow:0 0 0 4px rgba(255,255,255,.05),0 0 34px rgba(98,89,240,.55);
}
.bookmark{
  position:absolute;left:32%;right:32%;top:21%;bottom:20%;background:#fff;
  clip-path:polygon(0 0,100% 0,100% 100%,50% 75%,0 100%);
}
.copy{min-width:0;position:relative;z-index:1}
.eyebrow{
  color:#34e6f2;text-transform:uppercase;font:700 ${compact ? 10 : 14}px ui-monospace,monospace;
  letter-spacing:.22em;text-shadow:0 0 12px rgba(52,230,242,.65);margin-bottom:${compact ? 7 : 13}px
}
h1{font-size:${compact ? 28 : 58}px;line-height:1.03;margin:0;letter-spacing:-.035em;white-space:nowrap}
.cn{color:#fff}.dash{color:#8d84ff}
p{margin:${compact ? 9 : 18}px 0 0;color:#c8c5e9;font-size:${compact ? 14 : 26}px;font-weight:550;white-space:nowrap}
.meter{display:flex;gap:${compact ? 2 : 5}px;margin-top:${compact ? 15 : 28}px;height:${compact ? 8 : 14}px;max-width:${compact ? 230 : 520}px}
.seg{flex:1;background:rgba(120,90,255,.2);border-radius:1px}
.seg.on{background:linear-gradient(#55f3ff,#199ecf);box-shadow:0 0 8px rgba(52,230,242,.7)}
.score{
  position:absolute;right:${compact ? 18 : 35}px;top:${compact ? 14 : 28}px;
  color:#ffc63d;font:700 ${compact ? 9 : 13}px ui-monospace,monospace;letter-spacing:.14em
}
</style></head><body><div class="frame">
  <div class="icon"><div class="bookmark"></div></div>
  <div class="copy">
    <div class="eyebrow">READING QUEUE · STAGE 01</div>
    <h1>${compact ? 'Focus Reader' : 'Focus Reader <span class="dash">—</span> <span class="cn">读完再存</span>'}</h1>
    <p>${compact ? '读完再存 · 收藏自由，注意力限量' : '收藏自由，注意力限量'}</p>
    <div class="meter">${Array.from({ length: compact ? 16 : 24 }, (_, i) => `<i class="seg${i < (compact ? 9 : 14) ? ' on' : ''}"></i>`).join('')}</div>
  </div>
  <div class="score">SCORE 0118400</div>
</div></body></html>`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const width = Number(url.searchParams.get('w')) || 440;
  const height = Number(url.searchParams.get('h')) || 280;
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html(width, height));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const serverPort = server.address().port;

const debugPort = await freePort();
const chrome = launchChrome({ port: debugPort, extraArgs: ['--hide-scrollbars'] });

async function capture(browser, width, height, filename) {
  const url = `http://127.0.0.1:${serverPort}/?w=${width}&h=${height}`;
  const { targetId } = await browser.send('Target.createTarget', { url });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const ready = await browser.waitFor(
    sessionId,
    `document.readyState === 'complete' && location.href === ${JSON.stringify(url)}`,
    (value) => value === true,
  );
  if (ready !== true) throw new Error(`${filename}: 页面加载超时`);
  const { data } = await browser.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    sessionId,
  );
  writeFileSync(join(OUT, filename), Buffer.from(data, 'base64'));
  await browser.send('Target.closeTarget', { targetId });
  console.log(`  ✓ ${filename} (${width}×${height})`);
}

try {
  const version = await waitForEndpoint(`http://127.0.0.1:${debugPort}/json/version`);
  const browser = await Cdp.connect(version.webSocketDebuggerUrl);
  await capture(browser, 440, 280, 'promo-small-440x280.png');
  await capture(browser, 1400, 560, 'promo-marquee-1400x560.png');
  browser.close();
} finally {
  await chrome.dispose();
  await new Promise((resolve) => server.close(resolve));
}
