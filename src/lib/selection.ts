import { rootDomainOf } from './url';
import type { Candidate, SelectionStrategy } from './types';

export interface SelectionInput {
  candidates: Candidate[];
  size: number;
  /** Estimated reading time in minutes, injected so selectors stay synchronous. */
  estimate: (candidate: Candidate) => number;
  random?: () => number;
}

export interface Selector {
  id: SelectionStrategy;
  label: string;
  description: string;
  /** False for strategies that exist as a contract only (see AiSelector). */
  available: boolean;
  select(input: SelectionInput): Candidate[];
}

export class StrategyUnavailableError extends Error {
  constructor(public readonly strategy: SelectionStrategy) {
    super(`Selection strategy "${strategy}" is not available in this build.`);
    this.name = 'StrategyUnavailableError';
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i] as T;
    const b = copy[j] as T;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

const RandomSelector: Selector = {
  id: 'random',
  label: '随机',
  description: '完全随机抽取，最省心，也最容易撞见被遗忘的收藏。',
  available: true,
  select({ candidates, size, random = Math.random }) {
    return shuffle(candidates, random).slice(0, size);
  },
};

const OldestFirstSelector: Selector = {
  id: 'oldest-first',
  label: '最早收藏优先',
  description: '先清理沉在最底下的老收藏，专治「存了三年没看」。',
  available: true,
  select({ candidates, size }) {
    return candidates.slice().sort((a, b) => a.addedAt - b.addedAt).slice(0, size);
  },
};

const DomainDiversitySelector: Selector = {
  id: 'domain-diversity',
  label: '来源多样',
  description: '按域名轮流抽取，避免一整批都来自同一个网站。',
  available: true,
  select({ candidates, size, random = Math.random }) {
    const buckets = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const key = rootDomainOf(candidate.url) || candidate.url;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(candidate);
      else buckets.set(key, [candidate]);
    }

    const queues = shuffle([...buckets.values()], random).map((bucket) => shuffle(bucket, random));
    const picked: Candidate[] = [];
    let exhausted = false;
    while (picked.length < size && !exhausted) {
      exhausted = true;
      for (const queue of queues) {
        if (picked.length >= size) break;
        const next = queue.shift();
        if (next) {
          picked.push(next);
          exhausted = false;
        }
      }
    }
    return picked;
  },
};

const TimeBalancedSelector: Selector = {
  id: 'time-balanced',
  label: '时长均衡',
  description: '长短文章搭配，一批里既有能顺手读完的，也有值得坐下来啃的。',
  available: true,
  select({ candidates, size, estimate, random = Math.random }) {
    if (candidates.length <= size) return candidates.slice();
    const sorted = candidates
      .map((candidate) => ({ candidate, minutes: estimate(candidate) }))
      .sort((a, b) => a.minutes - b.minutes);

    // Stratified sampling: split the sorted list into `size` bands and take one
    // random article from each, so the batch spans the whole length spectrum.
    const picked: Candidate[] = [];
    const bandSize = sorted.length / size;
    for (let i = 0; i < size; i++) {
      const start = Math.floor(i * bandSize);
      const end = Math.max(start + 1, Math.floor((i + 1) * bandSize));
      const band = sorted.slice(start, end);
      const choice = band[Math.floor(random() * band.length)];
      if (choice) picked.push(choice.candidate);
    }

    // Guard against duplicate/empty bands on awkward sizes.
    const unique = new Map(picked.map((c) => [c.bookmarkId, c]));
    if (unique.size < size) {
      for (const { candidate } of shuffle(sorted, random)) {
        if (unique.size >= size) break;
        unique.set(candidate.bookmarkId, candidate);
      }
    }
    return [...unique.values()].slice(0, size);
  },
};

/**
 * v2 placeholder. The contract is fixed here so the reader, options page and
 * storage schema already speak "ai" as a strategy; only `select` is missing.
 */
const AiSelector: Selector = {
  id: 'ai',
  label: 'AI 选文',
  description: '由 AI 根据你的兴趣与当下状态挑选（即将推出）。',
  available: false,
  select() {
    throw new StrategyUnavailableError('ai');
  },
};

export const SELECTORS: Record<SelectionStrategy, Selector> = {
  random: RandomSelector,
  'oldest-first': OldestFirstSelector,
  'domain-diversity': DomainDiversitySelector,
  'time-balanced': TimeBalancedSelector,
  ai: AiSelector,
};

export function getSelector(strategy: SelectionStrategy): Selector {
  return SELECTORS[strategy] ?? RandomSelector;
}

/** Picks a batch, transparently falling back to random for unavailable strategies. */
export function pickBatch(strategy: SelectionStrategy, input: SelectionInput): Candidate[] {
  const selector = getSelector(strategy);
  if (!selector.available) return RandomSelector.select(input);
  return selector.select(input);
}
