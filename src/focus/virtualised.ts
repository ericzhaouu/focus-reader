import { wordCountOf } from '../lib/estimate';

/**
 * Recovers documents that only keep their visible blocks in the DOM.
 *
 * Feishu/Lark docx, Notion and similar editors virtualise long documents: as you
 * scroll, blocks are mounted and unmounted, so at any instant the DOM holds a
 * small window of the real content. Readability copes fine with their
 * non-semantic markup — measured at 98% on a fully rendered fixture — but on a
 * virtualised one it confidently extracts a fraction of the document and produces
 * a reader view that looks complete and is not. Silently losing most of an
 * article is worse than declining to render it.
 *
 * Walking the scroll container forces every block through the DOM once, which is
 * enough to capture them. Measured on an 80-block fixture: all 80 recovered in
 * ~0.6s with no gaps, and the page's own virtualisation left intact.
 */

/** Attributes these editors use to identify a block, in order of preference. */
const BLOCK_ID_ATTRS = ['data-block-id', 'data-block-index', 'data-id', 'data-key'];

/** Containers whose content is the document body rather than page furniture. */
const BLOCK_SELECTOR = '[data-block-id], [data-block-index], [data-id], [data-key]';

const MIN_SCROLLABLE_OVERFLOW = 400;
/** Below this, a short document is fully rendered and the normal path is fine. */
const MIN_VIRTUALISED_RATIO = 1.6;
const COLLECTION_BUDGET_MS = 6000;
const SETTLE_MS = 45;

export interface CollectedDocument {
  html: string;
  blocks: number;
  wordCount: number;
  /** True when blocks appeared that were not in the DOM when we started. */
  recovered: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function blockKey(element: Element): string | null {
  for (const attribute of BLOCK_ID_ATTRS) {
    const value = element.getAttribute(attribute);
    if (value) return `${attribute}:${value}`;
  }
  return null;
}

/**
 * Picks the element that scrolls the document. Deliberately not just
 * documentElement: these editors usually scroll an inner pane.
 */
export function findScrollContainer(doc: Document): Element | null {
  let best: Element | null = null;
  let bestOverflow = 0;

  const candidates: Element[] = [doc.scrollingElement, doc.documentElement, doc.body].filter(
    (node): node is Element => node instanceof Element,
  );
  candidates.push(...Array.from(doc.querySelectorAll('div, main, section, article')));

  for (const element of candidates) {
    const overflow = element.scrollHeight - element.clientHeight;
    if (overflow < MIN_SCROLLABLE_OVERFLOW) continue;
    if (element !== doc.scrollingElement && element !== doc.documentElement) {
      const overflowY = doc.defaultView?.getComputedStyle(element).overflowY ?? '';
      if (!/auto|scroll/.test(overflowY)) continue;
    }
    if (overflow > bestOverflow) {
      bestOverflow = overflow;
      best = element;
    }
  }
  return best;
}

/**
 * A virtualised container is much taller than the content it currently holds.
 * Comparing rendered block height against scrollHeight separates it from a long
 * page that simply happens to be fully in the DOM.
 */
export function looksVirtualised(scroller: Element): boolean {
  const blocks = scroller.querySelectorAll(BLOCK_SELECTOR);
  if (blocks.length < 3) return false;

  let renderedHeight = 0;
  for (const block of Array.from(blocks)) {
    renderedHeight += (block as HTMLElement).getBoundingClientRect().height;
  }
  if (renderedHeight <= 0) return false;

  return scroller.scrollHeight / renderedHeight >= MIN_VIRTUALISED_RATIO;
}

interface Harvested {
  order: number;
  html: string;
  text: string;
}

/**
 * Scrolls the container end to end, keeping every block seen along the way.
 *
 * Blocks are keyed by their own id so a remount does not duplicate them, and
 * ordered by document offset so the reassembled article keeps its original
 * sequence even though the DOM never held all of it at once.
 */
export async function collectVirtualisedDocument(
  scroller: Element,
): Promise<CollectedDocument | null> {
  const seen = new Map<string, Harvested>();
  const initialKeys = new Set<string>();

  const harvest = (): void => {
    for (const element of Array.from(scroller.querySelectorAll(BLOCK_SELECTOR))) {
      const key = blockKey(element);
      if (!key || seen.has(key)) continue;
      const text = (element as HTMLElement).innerText?.trim() ?? '';
      if (!text) continue;
      // Nested blocks would otherwise be captured twice, once inside the parent.
      if (element.parentElement?.closest(BLOCK_SELECTOR)) continue;
      const offsetTop = (element as HTMLElement).offsetTop;
      seen.set(key, { order: offsetTop, html: element.innerHTML, text });
    }
  };

  for (const element of Array.from(scroller.querySelectorAll(BLOCK_SELECTOR))) {
    const key = blockKey(element);
    if (key) initialKeys.add(key);
  }

  const startedAt = Date.now();
  const originalTop = scroller.scrollTop;
  const step = Math.max(240, scroller.clientHeight - 120);

  harvest();
  for (let top = 0; top <= scroller.scrollHeight; top += step) {
    scroller.scrollTop = top;
    await sleep(SETTLE_MS);
    harvest();
    if (Date.now() - startedAt > COLLECTION_BUDGET_MS) break;
  }
  // Put the reader back where they were; the scroll is an implementation detail.
  scroller.scrollTop = originalTop;

  if (seen.size === 0) return null;

  const ordered = [...seen.entries()].sort((a, b) => a[1].order - b[1].order);
  const html = ordered.map(([, block]) => `<div>${block.html}</div>`).join('\n');
  const text = ordered.map(([, block]) => block.text).join('\n');

  return {
    html,
    blocks: ordered.length,
    wordCount: wordCountOf(text),
    recovered: ordered.some(([key]) => !initialKeys.has(key)),
  };
}

/** Best-effort title for editors that render it outside the scroll container. */
export function findEditorTitle(doc: Document): string | null {
  const selectors = [
    '.docx-title',
    '[data-page-title]',
    '.notion-page-block [contenteditable]',
    'h1',
  ];
  for (const selector of selectors) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text && text.length <= 200) return text;
  }
  return null;
}
