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

export function extractArticle(doc: Document): Extracted | null {
  let parsed: ReturnType<Readability['parse']>;
  try {
    const clone = doc.cloneNode(true) as Document;
    materialiseLazyImages(clone);
    parsed = new Readability(clone, { charThreshold: 200 }).parse();
  } catch {
    return null;
  }

  if (!parsed?.content) return null;

  const text = parsed.textContent ?? '';
  const wordCount = wordCountOf(text);
  if (wordCount < MIN_WORD_COUNT) return null;

  const contentHtml = DOMPurify.sanitize(parsed.content, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset', 'sizes'],
  });

  return {
    title: cleanTitle(parsed.title || doc.title || '', parsed.siteName || null, doc),
    byline: parsed.byline || null,
    siteName: parsed.siteName || null,
    contentHtml,
    wordCount,
    minutes: minutesFromText(text),
  };
}
