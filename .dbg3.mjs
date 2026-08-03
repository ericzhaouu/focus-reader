import { readFileSync } from "node:fs";
import { Cdp, freePort, launchChrome, waitForEndpoint, sleep } from "./scripts/cdp.mjs";
import { startArticleServer } from "./scripts/sample-articles.mjs";
const src = readFileSync("dist/focus-inject.js","utf8");
const { port } = await startArticleServer();
const dbg = await freePort();
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

  const stub = await b.evaluate(`(() => {
     if (!window.chrome) window.chrome = {};
     Object.defineProperty(window.chrome, 'runtime', { configurable:true, writable:true, value: {
       sendMessage: (m) => { (window.__calls ||= []).push(m.type); return Promise.resolve(
         m.type === 'GET_FOCUS_CONTEXT' ? { bookmarkId:'demo', url:location.href, enabled:true,
           prefs:{fontSize:19,lineHeight:1.75,contentWidth:720,theme:'light',disabledDomains:[]} } : {ok:true}); },
     }});
     return typeof window.chrome.runtime.sendMessage === 'function';
   })()`, sessionId);
  console.log("stub ok:", stub);

  // Surface async rejections that Runtime.evaluate would otherwise swallow.
  await b.evaluate(`window.__err=null; window.addEventListener('unhandledrejection', e => { window.__err = String(e.reason && e.reason.stack || e.reason); }); 'ok'`, sessionId);
  await b.evaluate(src, sessionId);
  await sleep(3000);
  console.log(JSON.stringify(await b.evaluate(`({
    calls: window.__calls || null,
    err: window.__err,
    root: !!document.getElementById('__focus_reader_root__'),
    textLen: document.body.innerText.length,
  })`, sessionId), null, 2));
  b.close();
} finally { await chrome.dispose(); }
