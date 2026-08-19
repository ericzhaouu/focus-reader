/**
 * Deploys the built extension to a stable folder outside the repo.
 *
 * An unpacked extension's id is derived from its absolute path, so the install
 * location has to be somewhere permanent: move it later and Chrome treats it as a
 * brand new extension, wiping your reading history, streak and stats. It also must
 * not be the repo's `dist/`, which `npm run build` empties on every rebuild.
 *
 * Run with: npm run install:local
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

function defaultTarget() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'FocusReader', 'extension');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'FocusReader', 'extension');
  }
  return join(homedir(), '.local', 'share', 'focus-reader', 'extension');
}

const target = process.argv[2] ? resolve(process.argv[2]) : defaultTarget();

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json 不存在，请先运行 npm run build');
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')).version;
const firstInstall = !existsSync(target);

mkdirSync(dirname(target), { recursive: true });
// Replace the contents wholesale so removed files don't linger, but keep the
// folder path itself identical — that path is what the extension id depends on.
if (existsSync(target)) rmSync(target, { recursive: true, force: true });
cpSync(DIST, target, { recursive: true });

console.log(`
  已部署 v${version} → ${target}
`);

if (firstInstall) {
  console.log(`  首次安装，请在 Chrome 里完成最后一步：

  1. 打开 chrome://extensions
  2. 右上角打开「开发者模式」
  3. 点「加载已解压的扩展程序」
  4. 选择上面这个文件夹
  5. 建议点扩展栏的拼图图标，把 Focus Reader 固定到工具栏

  ⚠ 这个文件夹之后不要移动或删除。Chrome 用它的路径来标识扩展，
    换了位置就等于换了一个新扩展，阅读记录和统计都会清零。
`);
} else {
  console.log(`  已更新现有安装。到 chrome://extensions 点该扩展上的「重新加载」即可生效。
  （扩展 ID 不变，你的阅读记录和统计都会保留。）
`);
}
