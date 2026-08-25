/**
 * Validates the built manifest before anything is packaged or shipped.
 *
 * Exists because a mangled manifest is invisible in the source diff but very
 * visible in Chrome's extension list: PowerShell's `Get-Content` decodes a
 * BOM-less UTF-8 file using the system ANSI codepage, so a round trip through it
 * silently double-encodes every non-ASCII character. That shipped once.
 *
 * Run with: npm run check:manifest
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Signatures left behind when UTF-8 bytes are decoded as Windows-1252. */
const MOJIBAKE = /Ã[\u0080-\u00BF\u2000-\u206F]|â€|Â[\u00A0-\u00BF]|ï»¿/;

// Chrome Web Store listing limits.
const MAX_NAME = 75;
const MAX_DESCRIPTION = 132;

const problems = [];

function readJson(file) {
  const path = join(ROOT, file);
  const bytes = readFileSync(path);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push(`${file}: 含 BOM。`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    problems.push(`${file}: 不是合法 JSON — ${error.message}`);
    return null;
  }
}

function check(file, { expectVersion } = {}) {
  const json = readJson(file);
  if (!json) return null;

  for (const field of ['name', 'description', 'action']) {
    const value = field === 'action' ? json.action?.default_title : json[field];
    if (typeof value === 'string' && MOJIBAKE.test(value)) {
      problems.push(`${file}: ${field} 存在双重编码乱码 — ${JSON.stringify(value.slice(0, 40))}`);
    }
  }

  if (expectVersion && json.version !== expectVersion) {
    problems.push(`${file}: 版本 ${json.version} 与 package.json 的 ${expectVersion} 不一致。`);
  }

  return json;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const source = check('public/manifest.json', { expectVersion: pkg.version });

let built = null;
try {
  built = check('dist/manifest.json', { expectVersion: pkg.version });
} catch {
  // dist/ may legitimately not exist yet when this runs standalone.
}

const manifest = built ?? source;
if (manifest) {
  if (manifest.default_locale !== 'en') {
    problems.push(`default_locale 应为 en，实际为 ${JSON.stringify(manifest.default_locale)}。`);
  }

  const locales = ['en', 'zh_CN'];
  const catalogs = Object.fromEntries(
    locales.map((locale) => {
      const file = `public/_locales/${locale}/messages.json`;
      return [locale, readJson(file)];
    }),
  );
  const canonicalKeys = Object.keys(catalogs.en ?? {}).sort();
  const i18nSource = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8');
  const fallbackBlock = i18nSource.match(/FALLBACK_MESSAGES\s*=\s*\{([\s\S]*?)\}\s+as const/)?.[1] ?? '';
  const fallbackKeys = [...fallbackBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]+):/gm)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(fallbackKeys) !== JSON.stringify(canonicalKeys)) {
    const missing = canonicalKeys.filter((key) => !fallbackKeys.includes(key));
    const extra = fallbackKeys.filter((key) => !canonicalKeys.includes(key));
    problems.push(
      `i18n fallback 与 en catalog 不一致。缺少 [${missing.join(', ')}]，多出 [${extra.join(', ')}]。`,
    );
  }
  for (const locale of locales) {
    const catalog = catalogs[locale];
    if (!catalog) continue;
    const keys = Object.keys(catalog).sort();
    if (JSON.stringify(keys) !== JSON.stringify(canonicalKeys)) {
      const missing = canonicalKeys.filter((key) => !keys.includes(key));
      const extra = keys.filter((key) => !canonicalKeys.includes(key));
      problems.push(
        `${locale}: 翻译键不一致。缺少 [${missing.join(', ')}]，多出 [${extra.join(', ')}]。`,
      );
    }
    for (const [key, entry] of Object.entries(catalog)) {
      if (!entry || typeof entry.message !== 'string' || !entry.message.trim()) {
        problems.push(`${locale}: ${key} 缺少有效 message。`);
      } else if (MOJIBAKE.test(entry.message)) {
        problems.push(`${locale}: ${key} 存在双重编码乱码。`);
      }
      const referenced = [
        ...new Set(
          [...(entry?.message?.matchAll(/\$([A-Z][A-Z0-9_]*)\$/g) ?? [])].map(
            (match) => match[1].toLowerCase(),
          ),
        ),
      ].sort();
      const declared = Object.keys(entry?.placeholders ?? {}).sort();
      if (JSON.stringify(referenced) !== JSON.stringify(declared)) {
        problems.push(
          `${locale}: ${key} 的占位符声明不一致。引用 [${referenced.join(', ')}]，声明 [${declared.join(', ')}]。`,
        );
      }
      for (const [name, placeholder] of Object.entries(entry?.placeholders ?? {})) {
        if (!/^\$[1-9]$/.test(placeholder?.content ?? '')) {
          problems.push(`${locale}: ${key}.${name} 的 content 必须是 $1..$9。`);
        }
      }
    }
  }

  const messageRef = /^__MSG_([A-Za-z0-9_@]+)__$/;
  const resolveLocalized = (value, locale) => {
    const match = typeof value === 'string' ? value.match(messageRef) : null;
    if (!match) return value;
    const message = catalogs[locale]?.[match[1]]?.message;
    if (!message) problems.push(`${locale}: manifest 引用了不存在的消息 ${match[1]}。`);
    return message ?? '';
  };

  for (const locale of locales) {
    const name = resolveLocalized(manifest.name, locale);
    const description = resolveLocalized(manifest.description, locale);
    resolveLocalized(manifest.action?.default_title, locale);
    if (name.length > MAX_NAME) {
      problems.push(`${locale}: 名称 ${name.length} 字符，超过商店上限 ${MAX_NAME}。`);
    }
    if (description.length > MAX_DESCRIPTION) {
      problems.push(`${locale}: 描述 ${description.length} 字符，超过商店上限 ${MAX_DESCRIPTION}。`);
    }
  }
  if (!/[\u4e00-\u9fff]/.test(catalogs.zh_CN?.extensionName?.message ?? '')) {
    problems.push('zh_CN: 扩展名称里的中文丢失了。');
  }

  const permissions = [...(manifest.permissions ?? [])].sort();
  const expectedPermissions = ['bookmarks', 'storage'];
  if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
    problems.push(
      `权限应只有 ${expectedPermissions.join(', ')}，实际为 ${permissions.join(', ') || '(none)'}。`,
    );
  }
  if ((manifest.host_permissions ?? []).length || (manifest.optional_host_permissions ?? []).length) {
    problems.push('当前产品不应声明任何 host permission。');
  }
}

if (problems.length) {
  console.error('manifest 校验未通过：\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  ✓ manifest 与 en / zh_CN 翻译校验通过 — v${manifest.version}`);
