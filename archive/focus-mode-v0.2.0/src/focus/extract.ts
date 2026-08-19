import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { minutesFromText, wordCountOf } from '../lib/estimate';

export interface Extracted {
  title: string;
  byline: string | null;
  siteName: string | null;
  contentHtml: string;
  wordCount: number;
  minutes: number;
}

/**
 * Below this the "article" is almost certainly a landing page, a paywall stub or a
 * video page — cases where a reader view would be worse than the original.
 * `wordCountOf` counts CJK characters individually, so the threshold works for both
 * Latin and CJK content.
 */
const MIN_WORD_COUNT = 250;

const LAZY_ATTRIBUTES = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc'];

/** Separators sites use between an article title and their own name. */
const TITLE_SEPARATORS = /\s+[|\-–—/»·]\s+|_/;

/**
 * Readability only strips the trailing site name when the remainder still has 4+
 * whitespace-delimited words. Chinese titles have no spaces, so they always fail
 * that check and keep the `标题 - 站点名` suffix. This redoes the cleanup with a
 * CJK-aware length measure.
 */
function cleanTitle(rawTitle: string, siteName: string | null, doc: Document): string {
  const title = rawTitle.trim();
  if (!title || !TITLE_SEPARATORS.test(title)) return title;

  const segments = title
    .split(TITLE_SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length < 2) return title;

  const isSubstantial = (candidate: string): boolean => wordCountOf(candidate) >= 2;

  // The page's own <h1> is the most trustworthy signal when it matches a segment.
  const headings = Array.from(doc.querySelectorAll('h1'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean);
  for (const heading of headings) {
    const match = segments.find((segment) => segment === heading);
    if (match && isSubstantial(match)) return match;
  }

  if (siteName) {
    const remaining = segments.filter((segment) => segment !== siteName.trim());
    if (remaining.length && remaining.length < segments.length) {
      const joined = remaining.join(' - ');
      if (isSubstantial(joined)) return joined;
    }
  }

  // Fall back to dropping a short trailing segment, which is almost always the site.
  if (segments.length === 2) {
    const [head, tail] = segments as [string, string];
    if (wordCountOf(tail) <= 12 && isSubstantial(head) && wordCountOf(head) > wordCountOf(tail)) {
      return head;
    }
  }

  return title;
}

/**
 * Readability reads `src`, so lazy-loaded images would otherwise come out blank.
 * Runs on the clone, never on the live page.
 */
function materialiseLazyImages(doc: Document): void {
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (img.getAttribute('src')) continue;
    for (const attribute of LAZY_ATTRIBUTES) {
      const value = img.getAttribute(attribute);
      if (value) {
        img.setAttribute('src', value);
        break;
      }
    }
    const srcset = img.getAttribute('data-srcset');
    if (srcset && !img.getAttribute('srcset')) img.setAttribute('srcset', srcset);
  }
}

/** Loose comparison so punctuation and spacing differences don't defeat the match. */
function normaliseForCompare(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[.,:;!?—–\-_|·、，。：；！？「」『』"'()（）[\]【】]/g, '')
    .toLowerCase();
}

/**
 * Readability keeps the article's own <h1> inside the extracted content, so the
 * reader view would show the title twice — once in its header and again at the top
 * of the body. Drops that heading when it repeats the title.
 *
 * Matching the first heading anywhere in the content (rather than only the leading
 * children) is deliberate: Readability nests its output in wrapper divs whose depth
 * varies by page. A genuine section heading identical to the article title is
 * vanishingly rare, so this is safe.
 */
function stripDuplicateHeading(root: DocumentFragment, title: string): void {
  const target = normaliseForCompare(title);
  if (!target) return;
  const heading = root.querySelector('h1, h2');
  if (!heading) return;
  if (normaliseForCompare(heading.textContent ?? '') === target) heading.remove();
}

export function extractArticle(doc: Document): Extracted | null {
  const parsed = parseWithReadability(doc);
  if (!parsed) return null;

  const text = parsed.textContent ?? '';
  const wordCount = wordCountOf(text);
  if (wordCount < MIN_WORD_COUNT) return null;

  return finalise(doc, {
    rawHtml: parsed.content,
    title: parsed.title || doc.title || '',
    byline: parsed.byline || null,
    siteName: parsed.siteName || null,
    wordCount,
    text,
  });
}

/**
 * Builds an article from blocks harvested off a virtualised editor.
 *
 * Readability is skipped deliberately: its job is to guess which part of a page
 * is the article, and here that is already known — the blocks came out of the
 * document's own scroll container. Running it again would only risk discarding
 * content that was expensive to recover.
 */
export function extractFromCollected(
  doc: Document,
  collected: { html: string; wordCount: number },
  title: string,
): Extracted | null {
  if (collected.wordCount < MIN_WORD_COUNT) return null;

  const container = doc.createElement('div');
  container.innerHTML = collected.html;
  const text = container.innerText ?? container.textContent ?? '';

  return finalise(doc, {
    rawHtml: collected.html,
    title,
    byline: null,
    siteName: null,
    wordCount: collected.wordCount,
    text,
  });
}

interface Finalisable {
  rawHtml: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  wordCount: number;
  text: string;
}

function finalise(doc: Document, input: Finalisable): Extracted {
  const clean = DOMPurify.sanitize(input.rawHtml, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset', 'sizes'],
  });

  const title = cleanTitle(input.title, input.siteName, doc);

  // A <template> parses inertly, so images and media are not fetched just to run
  // this cleanup. The markup is already sanitised, so nothing can be reintroduced.
  const template = doc.createElement('template');
  template.innerHTML = clean;
  stripDuplicateHeading(template.content, title);

  return {
    title,
    byline: input.byline,
    siteName: input.siteName,
    contentHtml: template.innerHTML,
    wordCount: input.wordCount,
    minutes: minutesFromText(input.text),
  };
}

function parseWithReadability(doc: Document): { content: string; textContent: string | null; title: string; byline: string | null; siteName: string | null } | null {
  try {
    const clone = doc.cloneNode(true) as Document;
    materialiseLazyImages(clone);
    const parsed = new Readability(clone, { charThreshold: 200 }).parse();
    if (!parsed?.content) return null;
    return {
      content: parsed.content,
      textContent: parsed.textContent ?? null,
      title: parsed.title ?? '',
      byline: parsed.byline ?? null,
      siteName: parsed.siteName ?? null,
    };
  } catch {
    return null;
  }
}
