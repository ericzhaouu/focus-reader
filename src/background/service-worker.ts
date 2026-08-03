import { abandon, invalidateBookmark, markOpened, markRead, recordWordCount } from '../lib/batch';
import { recordReadingSample } from '../lib/estimate';
import {
  broadcastBatchUpdated,
  type Request,
  type ResponseMap,
} from '../lib/messaging';
import { hasHostAccess } from '../lib/permissions';
import { getConfig, getFocusPrefs, patchFocusPrefs } from '../lib/storage';
import { domainOf, isInjectableUrl } from '../lib/url';

const READER_PAGE = 'reader.html';
const INJECT_FILE = 'focus-inject.js';
const SESSION_KEY_TABS = 'focusTabs';
const SESSION_KEY_READER = 'readerTabId';

interface FocusTabEntry {
  bookmarkId: string;
  url: string;
  injected: boolean;
}

type FocusTabMap = Record<string, FocusTabEntry>;

async function getFocusTabs(): Promise<FocusTabMap> {
  const bag = await chrome.storage.session.get(SESSION_KEY_TABS);
  return (bag[SESSION_KEY_TABS] as FocusTabMap | undefined) ?? {};
}

async function setFocusTab(tabId: number, entry: FocusTabEntry | null): Promise<void> {
  const map = await getFocusTabs();
  if (entry) map[String(tabId)] = entry;
  else delete map[String(tabId)];
  await chrome.storage.session.set({ [SESSION_KEY_TABS]: map });
}

async function getReaderTabId(): Promise<number | null> {
  const bag = await chrome.storage.session.get(SESSION_KEY_READER);
  const id = bag[SESSION_KEY_READER];
  return typeof id === 'number' ? id : null;
}

function readerUrl(): string {
  return chrome.runtime.getURL(READER_PAGE);
}

/** Reuses an already-open reader tab so the extension never litters the tab strip. */
async function openReader(): Promise<number | null> {
  // Deliberately tracked via session storage instead of `tabs.query({url})`, which
  // would force us to request the broad "tabs" permission.
  const existingId = await getReaderTabId();
  if (existingId !== null) {
    try {
      const tab = await chrome.tabs.get(existingId);
      if (tab.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        return tab.id;
      }
    } catch {
      await chrome.storage.session.remove(SESSION_KEY_READER);
    }
  }
  const created = await chrome.tabs.create({ url: readerUrl() });
  if (created.id !== undefined) {
    await chrome.storage.session.set({ [SESSION_KEY_READER]: created.id });
  }
  return created.id ?? null;
}

chrome.action.onClicked.addListener(() => {
  void openReader();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
});

/** Decides whether the reader view should be injected into a freshly loaded article. */
async function shouldInject(url: string): Promise<boolean> {
  if (!isInjectableUrl(url)) return false;
  const config = await getConfig();
  if (!config.focusMode) return false;
  const prefs = await getFocusPrefs();
  if (prefs.disabledDomains.includes(domainOf(url))) return false;
  return hasHostAccess();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  void (async () => {
    const map = await getFocusTabs();
    const entry = map[String(tabId)];
    if (!entry || entry.injected) return;
    const url = tab.url ?? entry.url;
    if (!(await shouldInject(url))) return;

    await setFocusTab(tabId, { ...entry, injected: true });
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [INJECT_FILE] });
    } catch (error) {
      // Restricted pages, download targets and CSP-hardened PDFs simply keep the
      // original page; focus mode is a bonus, never a hard requirement.
      console.warn('[focus-reader] injection skipped:', error);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await setFocusTab(tabId, null);
    if ((await getReaderTabId()) === tabId) {
      await chrome.storage.session.remove(SESSION_KEY_READER);
    }
  })();
});

chrome.bookmarks.onRemoved.addListener((id) => {
  void (async () => {
    if (await invalidateBookmark(id)) broadcastBatchUpdated();
  })();
});

chrome.bookmarks.onMoved.addListener((id) => {
  void (async () => {
    // A manual move out of the queue folder is reconciled the same way as a delete.
    if (await invalidateBookmark(id)) broadcastBatchUpdated();
  })();
});

type Handler<T extends Request['type']> = (
  message: Extract<Request, { type: T }>,
  sender: chrome.runtime.MessageSender,
) => Promise<ResponseMap[T]>;

const handlers: { [K in Request['type']]: Handler<K> } = {
  async OPEN_ARTICLE(message) {
    try {
      const tab = await chrome.tabs.create({ url: message.url, active: true });
      if (tab.id !== undefined) {
        await setFocusTab(tab.id, {
          bookmarkId: message.bookmarkId,
          url: message.url,
          injected: false,
        });
      }
      await markOpened(message.bookmarkId);
      return { ok: true, tabId: tab.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async MARK_READ(message) {
    const result = await markRead(message.bookmarkId);
    if (result.ok) broadcastBatchUpdated();
    return result;
  },

  async ABANDON(message) {
    const result = await abandon(message.bookmarkId);
    if (result.ok) broadcastBatchUpdated();
    return result;
  },

  async GET_FOCUS_CONTEXT(_message, sender) {
    const prefs = await getFocusPrefs();
    const config = await getConfig();
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? sender.url ?? '';
    const map = await getFocusTabs();
    const entry = tabId === undefined ? undefined : map[String(tabId)];
    const enabled = config.focusMode && !prefs.disabledDomains.includes(domainOf(url));
    return { bookmarkId: entry?.bookmarkId ?? null, url, prefs, enabled };
  },

  async CLOSE_AND_RETURN(_message, sender) {
    const readerTabId = await getReaderTabId();
    if (readerTabId !== null) {
      try {
        await chrome.tabs.update(readerTabId, { active: true });
      } catch {
        await openReader();
      }
    } else {
      await openReader();
    }
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab already gone */
      }
    }
    return { ok: true };
  },

  async DISABLE_FOCUS_FOR_DOMAIN(message) {
    if (!message.domain) return { ok: false };
    const prefs = await getFocusPrefs();
    if (!prefs.disabledDomains.includes(message.domain)) {
      await patchFocusPrefs({ disabledDomains: [...prefs.disabledDomains, message.domain] });
    }
    return { ok: true };
  },

  async SAVE_FOCUS_PREFS(message) {
    const prefs = await patchFocusPrefs(message.patch);
    return { ok: true, prefs };
  },

  async RECORD_READING_SAMPLE(message, sender) {
    await recordReadingSample(message.url, message.minutes);
    if (message.words && sender.tab?.id !== undefined) {
      const map = await getFocusTabs();
      const entry = map[String(sender.tab.id)];
      if (entry) await recordWordCount(entry.bookmarkId, message.words);
    }
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  const handler = handlers[message?.type as Request['type']] as
    | ((m: Request, s: chrome.runtime.MessageSender) => Promise<unknown>)
    | undefined;
  if (!handler) return false;
  handler(message, sender).then(sendResponse, (error: unknown) => {
    console.error('[focus-reader] handler failed:', message?.type, error);
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true; // keep the channel open for the async response
});
