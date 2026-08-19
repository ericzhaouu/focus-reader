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

function check(file, { expectVersion } = {}) {
  const path = join(ROOT, file);
  const bytes = readFileSync(path);

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push(`${file}: 含 BOM。Vite 解析 package.json 时会失败，Chrome 也可能拒绝。`);
  }

  const text = bytes.toString('utf8');
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    problems.push(`${file}: 不是合法 JSON — ${error.message}`);
    return null;
  }

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
  if ((manifest.name ?? '').length > MAX_NAME) {
    problems.push(`名称 ${manifest.name.length} 字符，超过商店上限 ${MAX_NAME}。`);
  }
  if ((manifest.description ?? '').length > MAX_DESCRIPTION) {
    problems.push(`描述 ${manifest.description.length} 字符，超过商店上限 ${MAX_DESCRIPTION}。`);
  }
  // A name that lost its non-ASCII characters entirely is also a failure mode.
  if (!/[\u4e00-\u9fff]/.test(manifest.name ?? '')) {
    problems.push(`名称里的中文丢失了 — ${JSON.stringify(manifest.name)}`);
  }
}

if (problems.length) {
  console.error('manifest 校验未通过：\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  ✓ manifest 校验通过 — ${manifest.name} v${manifest.version}`);
