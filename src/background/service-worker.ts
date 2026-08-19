import { abandon, invalidateBookmark, markOpened, markRead } from '../lib/batch';
import {
  broadcastBatchUpdated,
  type Request,
  type ResponseMap,
} from '../lib/messaging';
import { getConfig } from '../lib/storage';

const READER_PAGE = 'reader.html';
const SESSION_KEY_READER = 'readerTabId';

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
  // Tracked via session storage instead of `tabs.query({url})`, which would force
  // us to request the broad "tabs" permission.
  const existingId = await getReaderTabId();
  if (existingId !== null) {
    try {
      const tab = await chrome.tabs.get(existingId);
      if (tab.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
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
  // v0.2 and earlier stored reader-view preferences and injection state. The
  // active product no longer reads page content, so discard those obsolete keys
  // and rewrite config without the old `focusMode` property.
  void (async () => {
    await chrome.storage.local.set({ config: await getConfig() });
    await chrome.storage.local.remove('focusPrefs');
    await chrome.storage.session.remove('focusTabs');
    try {
      // Explicitly shed a host grant that a user may have approved in v0.2.
      // Chrome normally revokes permissions removed from the manifest on update;
      // this makes the migration deterministic for unpacked/local installs too.
      const legacyOrigins = { origins: ['<all_urls>'] };
      if (await chrome.permissions.contains(legacyOrigins)) {
        await chrome.permissions.remove(legacyOrigins);
      }
    } catch (error) {
      console.warn('[focus-reader] legacy host permission cleanup was unnecessary:', error);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
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
) => Promise<ResponseMap[T]>;

const handlers: { [K in Request['type']]: Handler<K> } = {
  async OPEN_ARTICLE(message) {
    try {
      const tab = await chrome.tabs.create({ url: message.url, active: true });
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
};

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  const handler = handlers[message?.type as Request['type']] as
    | ((m: Request) => Promise<unknown>)
    | undefined;
  if (!handler) return false;

  handler(message).then(sendResponse, (error: unknown) => {
    console.error('[focus-reader] handler failed:', message?.type, error);
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
