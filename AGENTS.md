# Focus Reader — Agent Engineering Guide

This file is the repository-level source of truth for coding agents such as
GitHub Copilot, Codex, Claude Code, and other automated contributors.

Read this file before changing code. Product invariants in this document take
priority over speculative refactors or apparently simpler implementations.

## 1. Product in one sentence

Focus Reader turns one Chrome bookmark folder into a finite, locked reading
queue: show only a small batch of saved articles, and unlock the next batch only
after the current one is handled.

The core idea is:

> Saving remains unlimited. Attention is limited.

The extension deliberately does **not** block Ctrl+D, intercept new bookmarks,
or create another read-later inbox. The constraint exists only in the reading
queue.

## 2. Current product boundaries

The active product:

- is a Chrome Manifest V3 extension;
- uses React, TypeScript, and Vite;
- reads one user-selected bookmark folder;
- draws batches of 1–10 direct child bookmarks;
- opens source pages without reading or modifying their content;
- archives read bookmarks;
- permanently deletes abandoned bookmarks after UI confirmation;
- stores queue state and statistics locally;
- presents progress as an arcade-style milestone system;
- supports English and Simplified Chinese;
- has no backend, account system, analytics, advertising, or telemetry.

The active manifest must request exactly:

```text
bookmarks
storage
```

Do not add `tabs`, `scripting`, host permissions, optional host permissions, or
remote code without an explicit product decision and updated privacy/listing
disclosures.

## 3. Non-negotiable behavior

### 3.1 Bookmarking is never restricted

- Users may continue saving unlimited bookmarks.
- The extension must not intercept or reverse bookmark creation.
- The reader page must not expose an "add article" action.
- Focus Reader limits only the articles visible in the current queue batch.

### 3.2 A batch is locked

- Batch size is configurable from 1 through 10.
- A new batch may be drawn only when there is no current batch or the current
  batch has no unread items.
- Editing the configured batch size affects the next batch, not the current one.
- If the folder has fewer items than the configured size, draw all available
  items.
- The current batch persists across page closes, Chrome restarts, and computer
  restarts.

### 3.3 Reroll allowance

- The user receives one whole-batch reroll per local calendar day.
- The allowance resets when the date changes.
- A batch cannot be rerolled once any item has been read or abandoned.
- This restriction prevents difficult articles from being swapped indefinitely.
- An individual article can still leave the batch through Read or Abandon.

### 3.4 Open means open the original page

- `OPEN_ARTICLE` creates a normal Chrome tab at the bookmark URL.
- Do not inject UI or scripts into the source page.
- Do not scrape, extract, summarize, or rewrite source content.
- The extension must remain unable to read source-page content.

### 3.5 Read means archive safely

Chrome cannot mutate a bookmark's `dateAdded`. To make the archive timestamp
represent the date the article was completed:

1. Create a new bookmark with the same title and URL in the archive subfolder.
2. Only after creation succeeds, remove the original bookmark.

The order is mandatory: **create before delete**.

If deletion fails after the copy is created, preserving duplicate bookmarks is
preferable to data loss.

The archived bookmark receives a new ID. Batch items therefore keep the original
`bookmarkId` and may record an `archivedId`.

### 3.6 Abandon means permanent deletion

- Abandon removes the bookmark permanently.
- The UI must require two clicks:
  - first click arms the confirmation;
  - second click executes deletion;
  - confirmation expires after four seconds.
- Abandoned items do not count as read.
- Abandoned items do not block batch completion.

### 3.7 Archived and abandoned states are not interchangeable

`BatchItem.status` values:

```text
unread
read
abandoned
invalid
```

- `read`: archived by the extension and counted in reading statistics.
- `abandoned`: explicitly deleted by the user and counted only as abandoned.
- `invalid`: externally removed or moved; it no longer blocks completion but is
  not counted as read or abandoned.

## 4. Repository map

```text
public/
  manifest.json                MV3 manifest; localized through __MSG_* keys
  _locales/en/messages.json    default English Chrome i18n catalog
  _locales/zh_CN/messages.json Simplified Chinese Chrome i18n catalog
  icons/                       packaged extension icons

src/
  background/service-worker.ts extension action, tab opening, bookmark events,
                               runtime message handlers, upgrade cleanup
  lib/
    batch.ts                   queue state machine and statistics mutations
    bookmarks.ts               Chrome bookmark API wrappers and archive logic
    equivalence.ts             arcade milestones and word/score formatting
    estimate.ts                URL/domain-based reading-time estimates
    i18n.ts                    typed message keys, fallback catalog, page locale
    messaging.ts               typed reader ↔ service-worker message protocol
    selection.ts               batch selection strategies
    storage.ts                 normalized chrome.storage.local access
    types.ts                   persistent data types and defaults
    url.ts                     URL/domain helpers
  reader/                      main reading queue React application
  options/                     settings React application
  styles/                      shared UI and arcade styles

scripts/
  check-manifest.mjs           package, locale, permission, and encoding guard
  smoke-test.mjs               state-machine tests with an in-memory Chrome mock
  e2e-test.mjs                 real Chrome full English queue flow
  e2e-i18n.mjs                real Chrome Simplified Chinese locale verification
  screenshots.mjs              localized Store screenshots
  promo-assets.mjs             Store promo tiles
  install-local.mjs            copy dist/ to a stable unpacked install directory
  update.mjs                   pull, install, build, and redeploy
  release.mjs                  publish a GitHub Release asset
  zip.mjs                      package dist/ as a Store-ready zip

archive/
  focus-mode-v0.2.0/           removed reader-view feature and restoration
                               snapshots; not part of active build/package
```

## 5. Runtime architecture

### 5.1 Extension action

`chrome.action.onClicked` calls `openReader()`.

The reader tab ID is saved in `chrome.storage.session` under `readerTabId`.
Opening the action again reuses and focuses the existing reader tab when
possible.

This avoids `chrome.tabs.query({url})`, which would require broader permission.

### 5.2 Reader application

`src/reader/App.tsx`:

- loads queue state and statistics;
- renders setup, missing-folder, empty-folder, no-batch, active-batch, and
  completed-batch states;
- sends only `OPEN_ARTICLE`, `MARK_READ`, and `ABANDON` messages;
- refreshes after background broadcasts or when page visibility returns.

### 5.3 Settings application

`src/options/App.tsx`:

- renders a bookmark-folder tree;
- chooses the source folder;
- configures batch size;
- configures an available selection strategy;
- configures the archive subfolder name.

Settings changes are stored immediately.

### 5.4 Background service worker

The service worker:

- opens/reuses the reader page;
- opens original source URLs;
- handles Read and Abandon mutations;
- watches external bookmark removals and moves;
- broadcasts queue updates;
- removes obsolete focus-mode state and legacy host grants during upgrades.

MV3 service workers can be terminated at any time. Never rely solely on
in-memory state for durable correctness.

## 6. Persistent data model

All persistent data is in `chrome.storage.local`.

### `config`

```ts
interface Config {
  folderId: string | null;
  batchSize: number;               // normalized to 1..10
  strategy: SelectionStrategy;
  archiveFolderName: string;
}
```

The archive name is user data once stored. Do not overwrite an existing Chinese
or English archive name merely because the UI locale changes.

New users receive the localized archive name:

- English: `Read Archive`
- Simplified Chinese: `已读归档`

### `currentBatch`

```ts
interface CurrentBatch {
  items: BatchItem[];
  drawnAt: number;
  folderId: string;
  batchSize: number;
  revision: number;
}
```

`revision` is required for cross-context optimistic concurrency checks.

### `stats`

```ts
interface Stats {
  totalRead: number;
  streakDays: number;
  lastReadDate: string | null;
  dailyCounts: Record<string, number>;
  batchesCompleted: number;
  totalAbandoned: number;
  totalWords: number;
  lastRerollDate: string | null;
}
```

Statistics are normalized when read so old or partial records do not crash the
UI.

### Legacy fields

Old batches may contain `BatchItem.words` from the removed focus-mode version.
New Read actions intentionally ignore that value because site-dependent
extraction was unreliable. Arcade progress uses `estimatedMinutes` converted to
words.

Old `focusMode`, `focusPrefs`, and `focusTabs` data is removed during extension
upgrade without resetting the queue or statistics.

## 7. Queue state machine

`loadQueueState()` is the canonical state derivation function.

Possible states:

```text
needs-setup
folder-missing
empty-folder
no-batch
batch
```

Never duplicate these derivation rules in React components.

### Reconciliation

Before presenting a stored batch, unread items are reconciled against the actual
bookmark tree:

- original bookmark still in queue folder → keep unread;
- matching URL found in archive folder → recover as read;
- bookmark missing or moved elsewhere → mark invalid.

Reconciliation exists because:

- users may edit bookmarks outside the extension;
- archiving changes bookmark IDs;
- a service worker may terminate between bookmark mutation and storage write.

Recovered reads must update statistics exactly once.

## 8. Concurrency and race protection

### In-context serialization

`withLock()` serializes batch mutations in one JavaScript context.

### Cross-context conflict detection

Reader pages and the service worker load separate module instances. The
in-memory lock cannot coordinate them. `CurrentBatch.revision` detects a
concurrent write before committing a mutation.

Do not remove either mechanism.

### Archive event race

Archiving removes the original bookmark, which fires `bookmarks.onRemoved`.
The module-level `archiving` set prevents the same live context from marking the
item invalid during the operation.

If a service worker restarts and loses this set, reconciliation repairs the
state by matching the URL in the archive folder.

### Archive-folder creation race

Chrome allows duplicate sibling folder names. `findOrCreateArchiveFolder()`:

- checks for an existing archive;
- creates one if missing;
- re-queries for duplicates;
- deterministically keeps one folder;
- moves contents safely;
- removes only an empty duplicate created by this operation.

Do not replace this with a simple check-then-create.

## 9. Candidate selection

Only direct child bookmarks of the selected folder are candidates.

`listCandidates()`:

- excludes subfolders, including the archive folder;
- accepts only HTTP(S) URLs;
- deduplicates candidates by URL.

Active strategies:

```text
random
oldest-first
domain-diversity
time-balanced
```

`ai` remains a disabled schema placeholder and must not appear in the UI.
Unavailable stored strategies fall back to Random.

## 10. Arcade progress

Reading progress is intentionally approximate because the active extension does
not read page content.

Flow:

1. Estimate reading minutes from URL/domain priors.
2. Convert minutes to estimated words.
3. Add estimated words when an item is marked Read.
4. Map total words onto 17 book-equivalent milestones.

The arcade UI displays:

- `STAGE`;
- zero-padded `SCORE`;
- streak as `COMBO`;
- 24-segment progress meter;
- 17-slot pixel bookshelf.

Milestone identity is stable through `Milestone.id`. Display titles are
localized and must not be used as persistent identifiers.

## 11. Localization

Chrome-native i18n is mandatory.

```text
default_locale: en
locales: en, zh_CN
```

### Rules

- Every active UI string must use `t()` from `src/lib/i18n.ts`.
- Manifest strings use `__MSG_*__`.
- Page titles and `<html lang>` are set by `setDocumentLocale()`.
- Dates use `Intl.DateTimeFormat(uiLocale())`.
- English is the fallback for Node tests and non-extension contexts.
- English and `zh_CN` catalogs must contain identical keys.
- Dynamic Chrome messages use named `$PLACEHOLDER$` tokens with `$1..$9`
  `content` mappings.
- Do not hardcode user-visible Chinese or English inside active React code.
- Existing stored user strings, especially archive folder names, must not be
  translated retroactively.

`npm run build` runs `scripts/check-manifest.mjs`, which validates:

- catalog key parity;
- fallback/catalog key parity;
- named placeholder declarations;
- valid JSON and no BOM;
- mojibake signatures;
- localized manifest references;
- Store name and description limits;
- exact permissions;
- package/manifest version equality.

### Localized Store screenshots

```text
store-assets/en/
store-assets/zh_CN/
```

Root Store screenshots remain Simplified Chinese for the Chinese README.

## 12. Privacy and security

The extension handles bookmark titles, URLs, queue state, and user actions
locally. Local handling still requires accurate Chrome Web Store disclosure.

Guarantees:

- no server;
- no remote code;
- no telemetry or analytics;
- no page-content access;
- no bookmark or activity transmission;
- no data sale or sharing.

Any change to permissions, data handling, remote services, analytics, sync, or
monetization requires updates to:

- `public/manifest.json`;
- `PRIVACY.md`;
- Store Privacy practices;
- Store listing;
- `AGENTS.md`;
- tests.

## 13. Build and test commands

Windows PowerShell may block `npm.ps1`; use `npm.cmd` when needed.

```bash
npm install
npm run typecheck
npm run build
npm test
```

Current test groups:

```text
npm run smoke      state machine with an in-memory Chrome API
npm run e2e        full English flow in real Chrome
npm run e2e:i18n   Simplified Chinese locale in real Chrome
```

Real Chrome tests use CDP directly and have no Puppeteer/Playwright dependency.

Chrome 137+ ignores `--load-extension`; tests install the unpacked extension
through `Extensions.loadUnpacked`.

### What to run

- Pure documentation change: no build required unless command/docs references
  changed.
- UI, state, storage, bookmarks, i18n, or manifest change:

```bash
npm run build
npm test
```

- Store asset change:

```bash
npm run screenshots
npm run promo-assets
```

## 14. Packaging, local install, and release

### Build

```bash
npm run build
```

Output is `dist/`. Vite empties `dist/`; never store hand-authored files there.

### Local install

```bash
npm run install:local
```

This builds and copies `dist/` to a stable platform-specific directory. The
absolute unpacked-extension path determines the Chrome extension ID; moving the
directory makes Chrome treat it as another extension and its local data will not
follow.

### Update local install

```bash
npm run update
```

This refuses a dirty tree, pulls with `--ff-only`, installs dependencies, builds,
and redeploys. Chrome still needs Reload on `chrome://extensions`.

### Package

```bash
npm run zip
```

Produces:

```text
release/focus-reader-vX.Y.Z.zip
```

Archive and repository files must not enter the zip.

### Release

Before releasing:

1. Change the version in both:
   - `package.json`
   - `public/manifest.json`
2. Regenerate `package-lock.json`.
3. Run build and tests.
4. Commit.
5. Create and push `vX.Y.Z`.
6. Run:

```bash
npm run release
```

The release script refuses to publish if `dist/manifest.json` and
`package.json` disagree.

### Encoding warning

Do not rewrite JSON using Windows PowerShell 5.1:

```powershell
Get-Content ... | Set-Content -Encoding UTF8
```

On this environment it previously:

- decoded BOM-less UTF-8 as Windows-1252;
- double-encoded Chinese text;
- added a BOM to JSON;
- broke Vite parsing and shipped a corrupted manifest.

Use Node, `apply_patch`, or `.NET UTF8Encoding($false)`.

## 15. Store publishing

The private submission checklist is:

```text
STORE-SUBMISSION.local.md
```

It is intentionally gitignored.

The public Store package must contain:

- localized manifest;
- `en` and `zh_CN` catalogs;
- only `bookmarks` and `storage` permissions;
- no archive files;
- no local planning files.

Store listing locales:

- English: use `store-assets/en/`;
- Simplified Chinese: use `store-assets/zh_CN/`.

## 16. Removed focus-mode feature

The page-extraction reader view was removed in v0.3.0 after real-world use showed
that extraction could silently omit content on different websites.

Its full restoration archive is:

```text
archive/focus-mode-v0.2.0/
```

The archive contains:

- feature-owned source;
- integration snapshots;
- package lock and build configuration;
- tests and fixtures;
- old screenshot;
- restoration notes.

The archive was reconstructed in a temporary tree and successfully built as
v0.2.0. It is not part of active typechecking, build output, or extension zip.

Do not reintroduce focus mode, page extraction, Readability, DOMPurify,
`scripting`, or host permissions unless the user explicitly reopens that product
decision.

## 17. Code conventions

- TypeScript strict mode is enabled.
- Do not use `any`, broad casts, or success-shaped fallbacks.
- Normalize all data read from storage.
- Keep Chrome API wrappers in `src/lib/`.
- Reuse typed messaging rather than ad hoc runtime messages.
- Preserve error results and surface them through existing UI patterns.
- Prefer deterministic reconciliation over trusting transient events.
- Comments should explain non-obvious constraints, not restate code.
- Keep active source free of speculative or hidden product features.

## 18. Change checklist for agents

Before editing:

1. Read `AGENTS.md`.
2. Inspect `git status`; never revert unrelated user changes.
3. Search for existing helpers before adding new ones.
4. Identify persistent-data and permission implications.

Before finishing:

1. Verify the exact requested behavior.
2. Run the relevant build and tests.
3. Check manifest permissions and localized catalogs.
4. Check upgrade compatibility with existing storage.
5. Check bookmark operations for data-loss risk.
6. Confirm `dist/` and the release zip contain no stale files.
7. Update README/privacy/Store notes if public behavior changed.

## 19. Things agents must not do

- Do not block bookmark creation.
- Do not add an "Add article" button to the reader.
- Do not allow batch size above 10.
- Do not allow unlimited or post-start rerolls.
- Do not delete a bookmark for Read before an archive copy exists.
- Do not make Abandon a one-click action.
- Do not trust only a module-level lock across extension contexts.
- Do not remove revision conflict checks.
- Do not add page-content access or broad permissions casually.
- Do not translate or rename existing stored archive folders.
- Do not expose disabled AI selection in the UI.
- Do not package `archive/`, local notes, or source-only files.
- Do not treat the removed focus-mode archive as active code.
