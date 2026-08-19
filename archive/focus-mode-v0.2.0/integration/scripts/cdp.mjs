/**
 * Minimal Chrome DevTools Protocol harness shared by the e2e scripts.
 *
 * Uses Node's built-in WebSocket so the repo needs no puppeteer/playwright.
 * Chrome 137+ ignores the `--load-extension` flag, so extensions are installed
 * through the CDP `Extensions.loadUnpacked` command instead.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
}

export async function waitForEndpoint(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`DevTools endpoint never became ready: ${url} (${lastError?.message ?? ''})`);
}

export class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();

  static async connect(wsUrl) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      cdp.#ws.addEventListener('open', res, { once: true });
      cdp.#ws.addEventListener('error', rej, { once: true });
    });
    cdp.#ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = cdp.#pending.get(message.id);
      if (!pending) return;
      cdp.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      this.#pending.set(id, { resolve: res, reject: rej });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /**
   * `userGesture` matters for anything gated behind a user activation, most
   * importantly `chrome.permissions.request`.
   */
  async evaluate(expression, sessionId, { userGesture = false } = {}) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result.value;
  }

  async waitFor(sessionId, expression, predicate, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      try {
        value = await this.evaluate(expression, sessionId);
        if (predicate(value)) return value;
      } catch {
        /* page still navigating */
      }
      await sleep(200);
    }
    return value;
  }

  waitForText(sessionId, predicate, timeoutMs = 15_000) {
    return this.waitFor(
      sessionId,
      'document.body.innerText',
      (text) => predicate(text ?? ''),
      timeoutMs,
    );
  }

  close() {
    this.#ws.close();
  }
}

/** Asks the OS for a free port so back-to-back runs never collide. */
export function freePort() {
  return new Promise((res, rej) => {
    const server = createServer();
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => res(port));
    });
  });
}

export function launchChrome({ port, extraArgs = [], headless = true }) {
  const chromePath = findChrome();
  if (!chromePath) return null;
  const profile = mkdtempSync(join(tmpdir(), 'focus-reader-e2e-'));
  const process_ = spawn(
    chromePath,
    [
      ...(headless ? ['--headless', '--disable-gpu'] : []),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  return {
    process: process_,
    async dispose() {
      const exited = new Promise((res) => process_.once('exit', res));
      process_.kill();
      await Promise.race([exited, sleep(5000)]);
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Chrome may still hold a handle on Windows; the temp dir is disposable. */
      }
    },
  };
}

export function createReporter() {
  let failures = 0;
  return {
    check(name, fn) {
      try {
        fn();
        console.log(`  \u2713 ${name}`);
      } catch (error) {
        failures++;
        console.error(`  \u2717 ${name}\n    ${error instanceof Error ? error.message : error}`);
      }
    },
    get failures() {
      return failures;
    },
  };
}
