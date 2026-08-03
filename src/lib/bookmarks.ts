import type { Candidate, FolderNode } from './types';

type Node = chrome.bookmarks.BookmarkTreeNode;

function isFolder(node: Node): boolean {
  return !node.url;
}

function toFolderNode(node: Node): FolderNode {
  return {
    id: node.id,
    title: node.title || '(未命名文件夹)',
    children: (node.children ?? []).filter(isFolder).map(toFolderNode),
  };
}

/** The whole bookmark hierarchy with leaf bookmarks stripped out, for the folder picker. */
export async function getFolderTree(): Promise<FolderNode[]> {
  const [root] = await chrome.bookmarks.getTree();
  if (!root?.children) return [];
  return root.children.filter(isFolder).map(toFolderNode);
}

export async function getNode(id: string): Promise<Node | null> {
  try {
    const [node] = await chrome.bookmarks.get(id);
    return node ?? null;
  } catch {
    return null;
  }
}

export async function folderExists(id: string): Promise<boolean> {
  const node = await getNode(id);
  return node !== null && isFolder(node);
}

/** Human readable breadcrumb such as `书签栏 / 待读`. */
export async function getFolderPath(id: string): Promise<string | null> {
  const parts: string[] = [];
  let cursor = await getNode(id);
  if (!cursor) return null;
  while (cursor) {
    if (cursor.parentId === undefined) break; // root node, not worth showing
    parts.unshift(cursor.title || '(未命名)');
    cursor = cursor.parentId ? await getNode(cursor.parentId) : null;
  }
  return parts.join(' / ');
}

/**
 * Direct bookmark children of the queue folder. Anything nested in a subfolder —
 * including the archive folder — is deliberately excluded, which is what keeps
 * archived articles out of future draws.
 */
export async function listCandidates(folderId: string): Promise<Candidate[]> {
  let children: Node[];
  try {
    children = await chrome.bookmarks.getChildren(folderId);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const node of children) {
    if (!node.url) continue;
    if (!/^https?:/i.test(node.url)) continue;
    if (seen.has(node.url)) continue;
    seen.add(node.url);
    candidates.push({
      bookmarkId: node.id,
      title: node.title || node.url,
      url: node.url,
      addedAt: node.dateAdded ?? 0,
    });
  }
  return candidates;
}

export async function countCandidates(folderId: string): Promise<number> {
  return (await listCandidates(folderId)).length;
}

/** Locates the archive subfolder without creating it. */
export async function findArchiveFolder(
  queueFolderId: string,
  archiveFolderName: string,
): Promise<string | null> {
  try {
    const children = await chrome.bookmarks.getChildren(queueFolderId);
    const matches = children.filter((node) => isFolder(node) && node.title === archiveFolderName);
    return matches[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Finds the archive subfolder inside the queue folder, creating it on first use.
 *
 * Chrome happily creates duplicate folder names, so two archives racing on the very
 * first read could each create their own. The post-create re-query collapses that
 * back to a single deterministic winner.
 */
export async function findOrCreateArchiveFolder(
  queueFolderId: string,
  archiveFolderName: string,
): Promise<string> {
  const existing = await findArchiveFolder(queueFolderId, archiveFolderName);
  if (existing) return existing;

  const created = await chrome.bookmarks.create({
    parentId: queueFolderId,
    title: archiveFolderName,
  });

  const children = await chrome.bookmarks.getChildren(queueFolderId);
  const duplicates = children.filter((node) => isFolder(node) && node.title === archiveFolderName);
  if (duplicates.length <= 1) return created.id;

  // Keep the oldest folder and fold any concurrently-created empty duplicate into it.
  const [winner, ...losers] = duplicates as [chrome.bookmarks.BookmarkTreeNode, ...typeof duplicates];
  for (const loser of losers) {
    if (loser.id === winner.id) continue;
    try {
      const contents = await chrome.bookmarks.getChildren(loser.id);
      for (const node of contents) {
        await chrome.bookmarks.move(node.id, { parentId: winner.id });
      }
      // Only ever removes an empty folder this extension just created itself.
      if (loser.id === created.id) await chrome.bookmarks.remove(loser.id);
    } catch {
      /* leave the duplicate in place rather than risk touching user data */
    }
  }
  return winner.id;
}

export interface ArchiveResult {
  ok: boolean;
  /** True when the bookmark had already been removed outside the extension. */
  missing?: boolean;
  /** Id of the archived copy — archiving re-creates the bookmark, so this differs. */
  archivedId?: string;
  error?: string;
}

/**
 * Files a finished article into the archive subfolder.
 *
 * `chrome.bookmarks.update` cannot change `dateAdded`, so to make the archived copy
 * carry the date it was *read* rather than the date it was saved, the bookmark is
 * re-created and the original removed. The create always happens first: if anything
 * fails the user still has their bookmark, and the worst case is a duplicate.
 */
export async function archiveBookmark(
  bookmarkId: string,
  queueFolderId: string,
  archiveFolderName: string,
): Promise<ArchiveResult> {
  const node = await getNode(bookmarkId);
  if (!node) return { ok: false, missing: true };
  if (!node.url) return { ok: false, error: 'not-a-bookmark' };

  try {
    const archiveId = await findOrCreateArchiveFolder(queueFolderId, archiveFolderName);
    if (node.parentId === archiveId) return { ok: true, archivedId: node.id };

    const copy = await chrome.bookmarks.create({
      parentId: archiveId,
      title: node.title,
      url: node.url,
    });

    try {
      await chrome.bookmarks.remove(bookmarkId);
    } catch {
      // The copy is already safe; a leftover original is recoverable, lost data is not.
      return { ok: true, archivedId: copy.id };
    }
    return { ok: true, archivedId: copy.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Permanently drops an article the user decided not to read. */
export async function removeBookmark(bookmarkId: string): Promise<ArchiveResult> {
  const node = await getNode(bookmarkId);
  if (!node) return { ok: true, missing: true };
  try {
    await chrome.bookmarks.remove(bookmarkId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Looks for an already-archived copy of a url, used to recover interrupted archives. */
export async function findArchivedByUrl(
  archiveFolderId: string,
  url: string,
): Promise<string | null> {
  try {
    const children = await chrome.bookmarks.getChildren(archiveFolderId);
    return children.find((node) => node.url === url)?.id ?? null;
  } catch {
    return null;
  }
}
