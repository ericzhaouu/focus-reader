import { rootDomainOf } from './url';

const KEY_DOMAIN_SAMPLES = 'domainReadingSamples';

/**
 * Reading-time estimates are unavoidably rough: a bookmark only carries a title
 * and a URL. Domain priors provide a useful ordering signal without reading or
 * uploading page content.
 */
const DOMAIN_PRIORS: Record<string, number> = {
  'arxiv.org': 30,
  'nature.com': 22,
  'newyorker.com': 24,
  'theatlantic.com': 20,
  'longreads.com': 25,
  'substack.com': 14,
  'medium.com': 9,
  'paulgraham.com': 12,
  'stratechery.com': 14,
  'lesswrong.com': 16,
  'zhihu.com': 8,
  'jianshu.com': 8,
  'sspai.com': 9,
  'infoq.cn': 10,
  '36kr.com': 5,
  'github.com': 6,
  'stackoverflow.com': 5,
  'news.ycombinator.com': 3,
  'reddit.com': 4,
  'bbc.com': 4,
  'cnn.com': 4,
  'reuters.com': 4,
  'theverge.com': 4,
  'techcrunch.com': 4,
  'wikipedia.org': 12,
  'youtube.com': 12,
  'bilibili.com': 12,
};

const DEFAULT_MINUTES = 7;
const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

interface DomainSample {
  samples: number;
  averageMinutes: number;
}

export type LearnedPriors = Record<string, DomainSample>;

export async function loadLearnedPriors(): Promise<LearnedPriors> {
  const bag = await chrome.storage.local.get(KEY_DOMAIN_SAMPLES);
  const raw = bag[KEY_DOMAIN_SAMPLES];
  return raw && typeof raw === 'object' ? (raw as LearnedPriors) : {};
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(value)));
}

export function estimateMinutes(url: string, learned: LearnedPriors = {}): number {
  const domain = rootDomainOf(url);
  if (!domain) return DEFAULT_MINUTES;

  const observed = learned[domain];
  if (observed && observed.samples >= 2) return clampMinutes(observed.averageMinutes);

  const prior = DOMAIN_PRIORS[domain];
  if (prior !== undefined) {
    // With a single observation, blend it with the prior rather than trusting it outright.
    if (observed) return clampMinutes((prior + observed.averageMinutes) / 2);
    return prior;
  }
  if (observed) return clampMinutes(observed.averageMinutes);
  return DEFAULT_MINUTES;
}
