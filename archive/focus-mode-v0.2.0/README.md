# Archived focus reading mode (v0.2.0)

Removed from the active extension after extended real-world use showed that
site-specific extraction differences could silently omit content. Most reading
sessions ended up using the source page, so the feature's permissions, complexity,
and maintenance cost no longer justified keeping it active.

This archive preserves:

- the Readability + DOMPurify extraction pipeline
- Shadow DOM reader UI and typography controls
- virtualized document recovery for Feishu/Lark and Notion-like editors
- focus-mode and virtualized-document end-to-end tests
- the separate IIFE build configuration
- the original dual-config development watcher
- options-page styles used by the focus toggle, permission state, and disabled-domain chips
- the v0.2 package-lock, manifest checker, shared CDP harness, sample article server,
  queue tests, build config, and packaging scripts
- the store screenshot from v0.2.0
- snapshots of every active file that contained focus-mode integration before removal

The active product no longer requests `scripting` or `<all_urls>` permission.

The source page is now the only reading surface. Reading progress continues to use
the bookmark's estimated reading time when converting finished articles into words.

To restore the feature, use the integration snapshots as a reference rather than
copying only `src/focus/`: the implementation also depended on the background
service worker, messaging schema, storage types, options and reader UI, manifest,
dependencies, lockfile, second Vite build, manifest checker, development watcher,
release notes, tests, fixtures, and screenshots.
