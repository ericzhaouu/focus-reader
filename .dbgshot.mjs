import { readFileSync } from "node:fs";
import { Cdp, freePort, launchChrome, waitForEndpoint, sleep } from "./scripts/cdp.mjs";
import { startArticleServer } from "./scripts/sample-articles.mjs";
const src = readFileSync("dist/focus-inject.js","utf8");
const { port } = await startArticleServer();
const dbg = await freePort();
const chrome = launchChrome({ port: dbg, extraArgs: ["--window-size=1280,800"] });
try {
  const v = await waitForEndpoint(`http://127.0.0.1:${dbg}/json/version`);
  const b = await Cdp.connect(v.webSocketDebuggerUrl);
  const { targetId } = await b.send("Target.createTarget", { url: `http://127.0.0.1:${port}/a/why-we-save` });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  await b.send("Page.enable", {}, sessionId);
  await sleep(2500);
  console.log("readyState:", await b.evaluate("document.readyState", sessionId));
  console.log("chrome exists before stub:", await b.evaluate("typeof window.chrome", sessionId));
  const stub = await b.evaluate(`window.chrome = { runtime: { sendMessage: (m) => Promise.resolve(
      m.type === 'GET_FOCUS_CONTEXT' ? { bookmarkId:'d', url:location.href, enabled:true,
        prefs:{fontSize:19,lineHeight:1.75,contentWidth:720,theme:'light',disabledDomains:[]} } : {ok:true}) } };
      typeof window.chrome.runtime.sendMessage`, sessionId);
  console.log("stub installed:", stub);
  // capture any error from the bundle
  const r = await b.evaluate(`(() => { try { ${JSON.stringify(src)}; return 'src-is-string'; } catch(e){ return 'ERR '+e.message } })()`, sessionId);
  console.log("sanity:", r);
  await b.evaluate(src, sessionId);
  await sleep(2500);
  console.log("root present:", await b.evaluate("!!document.getElementById('__focus_reader_root__')", sessionId));
  console.log("body text len:", await b.evaluate("document.body.innerText.length", sessionId));
  console.log("article el:", await b.evaluate("!!document.querySelector('article')", sessionId));
  b.close();
} finally { await chrome.dispose(); }
