import { readFileSync } from "node:fs";
import { Cdp, freePort, launchChrome, waitForEndpoint, sleep } from "./scripts/cdp.mjs";
import { startArticleServer } from "./scripts/sample-articles.mjs";
const src = readFileSync("dist/focus-inject.js","utf8");
const { port } = await startArticleServer();

async function trial(label, { media, metrics }) {
  const dbg = await freePort();
  const chrome = launchChrome({ port: dbg, extraArgs: ["--window-size=1280,800","--hide-scrollbars"] });
  try {
    const v = await waitForEndpoint(`http://127.0.0.1:${dbg}/json/version`);
    const b = await Cdp.connect(v.webSocketDebuggerUrl);
    const { targetId } = await b.send("Target.createTarget", { url: `http://127.0.0.1:${port}/a/why-we-save` });
    const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Page.enable", {}, sessionId);
    if (media)   await b.send("Emulation.setEmulatedMedia", { features:[{name:"prefers-color-scheme",value:"light"}] }, sessionId);
    if (metrics) await b.send("Emulation.setDeviceMetricsOverride", { width:1280,height:800,deviceScaleFactor:1,mobile:false }, sessionId);
    await b.waitFor(sessionId, 'document.readyState === "complete"', x => x === true);
    await b.evaluate(`window.chrome = { runtime: { sendMessage: (m) => { (window.__calls ||= []).push(m.type); return Promise.resolve(
        m.type === 'GET_FOCUS_CONTEXT' ? { bookmarkId:'d', url:location.href, enabled:true,
          prefs:{fontSize:19,lineHeight:1.75,contentWidth:720,theme:'light',disabledDomains:[]} } : {ok:true}); } } }; 'ok'`, sessionId);
    await b.evaluate(src, sessionId);
    await sleep(2500);
    const r = await b.evaluate(`({ calls: window.__calls||null, root: !!document.getElementById('__focus_reader_root__'), chromeRuntime: typeof (window.chrome&&window.chrome.runtime) })`, sessionId);
    console.log(label, JSON.stringify(r));
    b.close();
  } finally { await chrome.dispose(); }
}
await trial("no-emulation      :", { media:false, metrics:false });
await trial("media-only        :", { media:true,  metrics:false });
await trial("metrics-only      :", { media:false, metrics:true  });
await trial("media+metrics     :", { media:true,  metrics:true  });
