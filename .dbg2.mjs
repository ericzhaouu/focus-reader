import { readFileSync } from "node:fs";
import { Cdp, freePort, launchChrome, waitForEndpoint, sleep } from "./scripts/cdp.mjs";
import { startArticleServer } from "./scripts/sample-articles.mjs";
const src = readFileSync("dist/focus-inject.js","utf8");
const { port } = await startArticleServer();
const dbg = await freePort();
// Replicate screenshots.mjs exactly: extension loaded + emulation overrides.
const chrome = launchChrome({ port: dbg, extraArgs: ["--window-size=1280,800","--hide-scrollbars"] });
try {
  const v = await waitForEndpoint(`http://127.0.0.1:${dbg}/json/version`);
  const b = await Cdp.connect(v.webSocketDebuggerUrl);
  await b.send("Extensions.loadUnpacked", { path: "C:\\Users\\zhaojian\\Downloads\\GH_Projects\\invest_ai\\dist" });
  const { targetId } = await b.send("Target.createTarget", { url: `http://127.0.0.1:${port}/a/why-we-save` });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  await b.send("Page.enable", {}, sessionId);
  await b.send("Emulation.setEmulatedMedia", { features: [{ name:"prefers-color-scheme", value:"light" }] }, sessionId);
  await b.send("Emulation.setDeviceMetricsOverride", { width:1280, height:800, deviceScaleFactor:1, mobile:false }, sessionId);
  await b.waitFor(sessionId, 'document.readyState === "complete"', x => x === true);
  await b.evaluate(`window.chrome = { runtime: { sendMessage: (m) => Promise.resolve(
      m.type === 'GET_FOCUS_CONTEXT' ? { bookmarkId:'demo', url:location.href, enabled:true,
        prefs:{fontSize:19,lineHeight:1.75,contentWidth:720,theme:'light',disabledDomains:[]} } : {ok:true}) } };
     'stubbed'`, sessionId);
  await b.evaluate(src, sessionId);
  await sleep(3000);
  const diag = await b.evaluate(`(() => {
    const host = document.getElementById('__focus_reader_root__');
    if (!host) return { root:false, chromeType: typeof window.chrome, hasRuntime: !!(window.chrome&&window.chrome.runtime) };
    const s = host.shadowRoot;
    const w = s && s.querySelector('.wrap');
    return { root:true, shadow: !!s, wrap: !!w, rect: w ? JSON.stringify(w.getBoundingClientRect()) : null };
  })()`, sessionId);
  console.log(JSON.stringify(diag, null, 2));
  b.close();
} finally { await chrome.dispose(); }
