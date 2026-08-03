/**
 * Focus mode needs to read page content, which means host access. We deliberately
 * keep `host_permissions` empty in the manifest and request `<all_urls>` at runtime,
 * so installing the extension asks for nothing scary and declining costs the user
 * only the reader view — never the queue itself.
 */
export const HOST_ACCESS: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

export async function hasHostAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains(HOST_ACCESS);
  } catch {
    return false;
  }
}

/**
 * Must be called synchronously from a user gesture (a click handler); awaiting
 * anything beforehand invalidates the gesture and Chrome rejects the prompt.
 */
export async function requestHostAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request(HOST_ACCESS);
  } catch {
    return false;
  }
}

export async function removeHostAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.remove(HOST_ACCESS);
  } catch {
    return false;
  }
}

export function onHostAccessChanged(listener: (granted: boolean) => void): () => void {
  const added = (): void => {
    void hasHostAccess().then(listener);
  };
  const removed = (): void => {
    void hasHostAccess().then(listener);
  };
  chrome.permissions.onAdded.addListener(added);
  chrome.permissions.onRemoved.addListener(removed);
  return () => {
    chrome.permissions.onAdded.removeListener(added);
    chrome.permissions.onRemoved.removeListener(removed);
  };
}
