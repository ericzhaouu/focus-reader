import { sendMessage } from '../lib/messaging';
import type { FocusPrefs, FocusTheme } from '../lib/types';
import { domainOf } from '../lib/url';
import { extractArticle, extractFromCollected, type Extracted } from './extract';
import {
  collectVirtualisedDocument,
  findEditorTitle,
  findScrollContainer,
  looksVirtualised,
} from './virtualised';
import css from './reader-view.css?inline';

const ROOT_ID = '__focus_reader_root__';

const HOST_BASE = 'all: initial; position: fixed; z-index: 2147483647;';
const HOST_OVERLAY = `${HOST_BASE} inset: 0;`;
const HOST_HINT = `${HOST_BASE} left: 0; right: 0; bottom: 0; top: auto; height: 0; pointer-events: none;`;

const LIMITS = {
  fontSize: [14, 28, 1],
  lineHeight: [1.3, 2.4, 0.05],
  contentWidth: [560, 1040, 40],
} as const;

const THEMES: FocusTheme[] = ['light', 'dark', 'sepia'];
const THEME_LABELS: Record<FocusTheme, string> = { light: '浅色', dark: '深色', sepia: '护眼' };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(article: Extracted): string {
  const meta = [article.byline, article.siteName, `约 ${article.minutes} 分钟`]
    .filter(Boolean)
    .map((part) => `<span>${escapeHtml(String(part))}</span>`)
    .join('');

  return `
    <div class="wrap" part="wrap">
      <div class="progress" data-el="progress"></div>
      <div class="bar">
        <button class="btn" data-act="back">← 返回清单</button>
        <span class="bar__spacer"></span>
        <button class="btn btn--icon" data-act="prefs" title="阅读设置">Aa</button>
        <button class="btn" data-act="original">看原页</button>
        <button class="btn btn--primary" data-act="read">标记已读</button>
      </div>
      <div class="panel" data-el="panel" hidden>
        <div class="panel__row">
          <span class="panel__label">字号</span>
          <span class="panel__group">
            <button class="btn stepper" data-step="fontSize:-1">−</button>
            <button class="btn stepper" data-step="fontSize:1">+</button>
          </span>
        </div>
        <div class="panel__row">
          <span class="panel__label">行距</span>
          <span class="panel__group">
            <button class="btn stepper" data-step="lineHeight:-1">−</button>
            <button class="btn stepper" data-step="lineHeight:1">+</button>
          </span>
        </div>
        <div class="panel__row">
          <span class="panel__label">宽度</span>
          <span class="panel__group">
            <button class="btn stepper" data-step="contentWidth:-1">−</button>
            <button class="btn stepper" data-step="contentWidth:1">+</button>
          </span>
        </div>
        <div class="panel__row">
          <span class="panel__label">主题</span>
          <span class="panel__group">
            ${THEMES.map(
              (theme) =>
                `<button class="btn seg" data-theme="${theme}" aria-pressed="false">${THEME_LABELS[theme]}</button>`,
            ).join('')}
          </span>
        </div>
      </div>
      <div class="scroll" data-el="scroll">
        <article class="article">
          <h1 class="article__title">${escapeHtml(article.title)}</h1>
          <div class="article__meta">${meta}</div>
          <div class="content" data-el="content"></div>
        </article>
      </div>
    </div>
    <div class="hint" data-el="hint" hidden>
      <span data-el="hint-text"></span>
      <button data-act="hint-disable">以后此站点不再自动进入</button>
      <button data-act="hint-restore">回到专注模式</button>
    </div>
  `;
}

function mount(article: Extracted, prefs: FocusPrefs, bookmarkId: string | null): void {
  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.style.cssText = HOST_OVERLAY;

  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];
  shadow.innerHTML = shell(article);

  // Appended to <html> rather than <body> so SPA re-renders can't wipe it out.
  document.documentElement.appendChild(host);

  const query = <T extends Element>(selector: string): T | null => shadow.querySelector<T>(selector);
  const wrap = query<HTMLElement>('.wrap');
  const content = query<HTMLElement>('[data-el="content"]');
  const scroll = query<HTMLElement>('[data-el="scroll"]');
  const progress = query<HTMLElement>('[data-el="progress"]');
  const panel = query<HTMLElement>('[data-el="panel"]');
  const hint = query<HTMLElement>('[data-el="hint"]');
  const hintText = query<HTMLElement>('[data-el="hint-text"]');
  if (!wrap || !content || !scroll || !progress || !panel || !hint || !hintText) return;

  // Already sanitised by DOMPurify inside extractArticle.
  content.innerHTML = article.contentHtml;
  for (const anchor of Array.from(content.querySelectorAll('a[href]'))) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }

  const documentOverflow = document.documentElement.style.overflow;
  const bodyOverflow = document.body?.style.overflow ?? '';
  let current: FocusPrefs = prefs;
  let overlayVisible = true;

  const applyPrefs = (): void => {
    wrap.style.setProperty('--fr-font-size', `${current.fontSize}px`);
    wrap.style.setProperty('--fr-line-height', String(current.lineHeight));
    wrap.style.setProperty('--fr-width', `${current.contentWidth}px`);
    wrap.dataset.theme = current.theme;
    for (const button of Array.from(panel.querySelectorAll<HTMLElement>('[data-theme]'))) {
      button.setAttribute('aria-pressed', String(button.dataset.theme === current.theme));
    }
  };

  const persistPrefs = (patch: Partial<FocusPrefs>): void => {
    void sendMessage({ type: 'SAVE_FOCUS_PREFS', patch });
  };

  const lockPageScroll = (locked: boolean): void => {
    document.documentElement.style.overflow = locked ? 'hidden' : documentOverflow;
    if (document.body) document.body.style.overflow = locked ? 'hidden' : bodyOverflow;
  };

  const setOverlayVisible = (visible: boolean): void => {
    overlayVisible = visible;
    wrap.style.display = visible ? '' : 'none';
    hint.hidden = visible;
    host.style.cssText = visible ? HOST_OVERLAY : HOST_HINT;
    lockPageScroll(visible);
    if (!visible) panel.hidden = true;
  };

  const teardown = (): void => {
    lockPageScroll(false);
    host.remove();
    document.removeEventListener('keydown', onKeyDown, true);
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !overlayVisible) return;
    event.stopPropagation();
    setOverlayVisible(false);
  }

  const step = (key: keyof typeof LIMITS, direction: number): void => {
    const [min, max, increment] = LIMITS[key];
    const next = Number((clamp(current[key] + direction * increment, min, max)).toFixed(2));
    if (next === current[key]) return;
    current = { ...current, [key]: next };
    applyPrefs();
    persistPrefs({ [key]: next });
  };

  shadow.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-act],[data-step],[data-theme]');
    if (!target) return;

    const stepAttr = target.dataset.step;
    if (stepAttr) {
      const [key, delta] = stepAttr.split(':');
      step(key as keyof typeof LIMITS, Number(delta));
      return;
    }

    const theme = target.dataset.theme;
    if (theme) {
      current = { ...current, theme: theme as FocusTheme };
      applyPrefs();
      persistPrefs({ theme: current.theme });
      return;
    }

    switch (target.dataset.act) {
      case 'back':
        void sendMessage({ type: 'CLOSE_AND_RETURN' });
        break;
      case 'read':
        if (!bookmarkId) {
          void sendMessage({ type: 'CLOSE_AND_RETURN' });
          break;
        }
        void sendMessage({ type: 'MARK_READ', bookmarkId }).then(() =>
          sendMessage({ type: 'CLOSE_AND_RETURN' }),
        );
        break;
      case 'prefs':
        panel.hidden = !panel.hidden;
        break;
      case 'original':
        setOverlayVisible(false);
        break;
      case 'hint-restore':
        setOverlayVisible(true);
        break;
      case 'hint-disable': {
        const domain = domainOf(location.href);
        void sendMessage({ type: 'DISABLE_FOCUS_FOR_DOMAIN', domain });
        teardown();
        break;
      }
      default:
        break;
    }
  });

  scroll.addEventListener('scroll', () => {
    const max = scroll.scrollHeight - scroll.clientHeight;
    const ratio = max > 0 ? clamp(scroll.scrollTop / max, 0, 1) : 0;
    progress.style.width = `${ratio * 100}%`;
  });

  document.addEventListener('keydown', onKeyDown, true);

  hintText.textContent = `已退出专注模式 · ${domainOf(location.href)}`;
  applyPrefs();
  lockPageScroll(true);
}

/**
 * Produces the article, recovering virtualised editors first.
 *
 * A virtualised document only keeps its visible blocks in the DOM, so extracting
 * straight away yields a fraction of it — and the result looks complete, which is
 * the dangerous part. Walking the scroll container puts every block through the
 * DOM once so the whole document can be captured.
 */
async function resolveArticle(): Promise<Extracted | null> {
  const scroller = findScrollContainer(document);
  if (scroller && looksVirtualised(scroller)) {
    const collected = await collectVirtualisedDocument(scroller);
    if (collected && collected.recovered) {
      const title = findEditorTitle(document) ?? document.title;
      const article = extractFromCollected(document, collected, title);
      if (article) return article;
    }
  }
  return extractArticle(document);
}

async function main(): Promise<void> {
  if (document.getElementById(ROOT_ID)) return;

  let context;
  try {
    context = await sendMessage({ type: 'GET_FOCUS_CONTEXT' });
  } catch {
    return;
  }
  if (!context?.enabled) return;

  const article = await resolveArticle();
  if (!article) return;

  // The measured length calibrates future time estimates and feeds the books milestone.
  void sendMessage({
    type: 'RECORD_READING_SAMPLE',
    url: location.href,
    minutes: article.minutes,
    words: article.wordCount,
  });

  mount(article, context.prefs, context.bookmarkId);
}

void main();
