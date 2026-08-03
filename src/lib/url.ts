export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Registrable-ish root used for grouping, e.g. `blog.example.com` -> `example.com`. */
export function rootDomainOf(url: string): string {
  const host = domainOf(url);
  if (!host) return '';
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const twoLevelTlds = new Set(['co.uk', 'com.cn', 'com.au', 'co.jp', 'co.kr', 'com.br', 'com.tw']);
  const lastTwo = parts.slice(-2).join('.');
  return twoLevelTlds.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}
