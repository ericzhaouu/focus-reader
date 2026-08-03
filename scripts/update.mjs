/**
 * Pulls the latest code and redeploys it to the stable install folder.
 *
 * An unpacked extension never auto-updates the way a store-installed one does:
 * Chrome reads it from disk and leaves it alone. So getting a new version means
 * refreshing the files and telling Chrome to re-read them.
 *
 * Run with: npm run update
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * Runs a fixed command line through the shell.
 *
 * Passed as one string rather than command + args because Node warns about the
 * latter under `shell: true` (it concatenates instead of escaping), while Windows
 * refuses to spawn npm's .cmd shim without a shell at all. Every command here is a
 * hard-coded literal, so there is nothing to inject.
 */
function run(label, commandLine) {
  const result = spawnSync(commandLine, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.error) {
    console.error(`  ${label}失败：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const before = git(['rev-parse', 'HEAD']);

if (git(['status', '--porcelain'])) {
  console.error(`
  仓库里有未提交的改动，先处理掉再更新：

    git status          # 看看改了什么
    git stash           # 或者先收起来

  （避免拉取时和你的改动冲突）
`);
  process.exit(1);
}

console.log('  拉取最新代码…');
// --ff-only so a diverged local history fails loudly instead of auto-merging.
const pull = spawnSync('git', ['pull', '--ff-only'], { cwd: ROOT, stdio: 'inherit' });
if (pull.status !== 0) {
  console.error(`
  拉取失败。通常是本地有远端没有的提交，检查一下：

    git log --oneline origin/main..HEAD
`);
  process.exit(1);
}

const after = git(['rev-parse', 'HEAD']);

if (before === after) {
  console.log('  已经是最新的代码。\n');
} else {
  const count = git(['rev-list', '--count', `${before}..${after}`]);
  console.log(`  拉到 ${count} 个新提交：`);
  console.log(
    git(['log', '--oneline', `${before}..${after}`])
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n'),
  );
  console.log('');
}

// Dependencies may have changed with the new code; npm ci would be stricter but
// also far slower for what is usually a no-op.
console.log('  检查依赖…');
run('依赖安装', 'npm install --no-audit --no-fund');

// Must go through install:local rather than install-local.mjs directly: the script
// only copies dist/, so calling it alone would deploy a stale build.
console.log('  构建并部署…');
run('构建部署', 'npm run install:local');

console.log(`  还差最后一步——Chrome 不会自己重新读取扩展文件：

    打开 chrome://extensions，点 Focus Reader 卡片上的「重新加载」⟳

  （或者干脆重启 Chrome，效果一样。扩展 ID 不变，
    你的阅读记录、统计和连续天数都会保留。）
`);
