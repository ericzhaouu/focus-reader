/**
 * Publishes a GitHub Release for the current version and attaches the store zip.
 *
 * Authentication reuses whatever credential git itself uses for the `origin`
 * remote, asked for through `git credential fill`. That avoids depending on a
 * separate `gh auth login`, which matters when the gh CLI is signed in as a
 * different account than the one that owns the repo. The token is held in memory
 * for the two API calls and never printed.
 *
 * Run with: npm run release
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(args, input) {
  return execFileSync('git', args, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Credentials are already stored from the first push; refuse to hang on a
      // prompt if they are not, so the failure is a clear message instead.
      GCM_INTERACTIVE: 'never',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

function parseRemote(url) {
  const match = url.trim().match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) throw new Error(`无法从 remote 解析 owner/repo：${url}`);
  return { owner: match[1], repo: match[2] };
}

/**
 * Asks git's configured credential helper for the token, without echoing it.
 * The helper indexes entries by username, so the repo owner is offered as the
 * hint — that is the account that owns the push credential in practice.
 */
function credentialFor(host, username) {
  const query = `protocol=https\nhost=${host}\n${username ? `username=${username}\n` : ''}\n`;
  let reply;
  try {
    reply = git(['credential', 'fill'], query);
  } catch (error) {
    throw new Error(
      `无法从 git 凭据助手取得令牌。请先执行一次 git push 完成登录。\n原始错误：${error.message}`,
    );
  }
  const fields = Object.fromEntries(
    reply
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  if (!fields.password) throw new Error('凭据助手没有返回令牌');
  return { username: fields.username, password: fields.password };
}

async function api(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'focus-reader-release',
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    // Deliberately surfaces the API message but never the token.
    let detail = text;
    try {
      detail = JSON.parse(text).message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`${options.method ?? 'GET'} ${new URL(url).pathname} → ${response.status} ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'dist', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = manifest.version;

// A build that failed leaves the previous dist/ in place, which would otherwise be
// published under the wrong version. Refuse rather than ship a mislabelled artifact.
if (version !== pkg.version) {
  console.error(
    `dist/ 与 package.json 版本不一致（dist ${version}，package ${pkg.version}）。\n` +
      '通常意味着构建失败或未重新构建，请先运行 npm run build。',
  );
  process.exit(1);
}

const tag = `v${version}`;
const asset = join(ROOT, 'release', `focus-reader-${tag}.zip`);

if (!existsSync(asset)) {
  console.error(`${asset} 不存在，请先运行 npm run zip`);
  process.exit(1);
}

const { owner, repo } = parseRemote(git(['remote', 'get-url', 'origin']));
const { password: token } = credentialFor('github.com', owner);

console.log(`  仓库：${owner}/${repo}`);
console.log(`  版本：${tag}\n`);

const notes = `把收藏夹变成一份**读得完**的清单。

### 安装

1. 下载下方的 \`focus-reader-${tag}.zip\` 并解压到一个**固定的文件夹**
2. 打开 \`chrome://extensions\`，右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择解压出的文件夹

> ⚠️ 解压后的文件夹不要移动或删除。Chrome 用它的路径来标识扩展，
> 换了位置等于换了个新扩展，阅读记录和统计会清零。

### 这一版有什么

- **配额锁**：一次只显示 N 篇（1–10），清单上没有任何新增入口；你的收藏行为完全不受限制
- **每日一次重选**：跨天恢复；但只要处理过这批里任何一篇，整批就不能再换
- **已读 / 放弃**：已读归档并把收藏时间刷新为读完当天；放弃则彻底删除（需二次确认）
- **阅读原网页**：点打开直接进入书签原网址，不读取或改写网页正文
- **街机进度**：用关卡、能量槽和像素书架呈现累计阅读量

### 隐私

无后端、无遥测，数据全部留在本地。不索取任何网页访问权限。
详见 [PRIVACY.md](https://github.com/${owner}/${repo}/blob/main/PRIVACY.md)。
`;

const existing = await api(token, `https://api.github.com/repos/${owner}/${repo}/releases`).then(
  (list) => list.find((release) => release.tag_name === tag),
);

let release;
if (existing) {
  console.log('  已存在同版本 Release，更新其内容…');
  release = await api(token, `https://api.github.com/repos/${owner}/${repo}/releases/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: `Focus Reader ${tag}`, body: notes }),
  });
} else {
  release = await api(token, `https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: `Focus Reader ${tag}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
}

// Re-uploading the same filename is rejected, so clear any previous copy first.
for (const old of release.assets ?? []) {
  if (old.name === `focus-reader-${tag}.zip`) {
    await api(token, `https://api.github.com/repos/${owner}/${repo}/releases/assets/${old.id}`, {
      method: 'DELETE',
    });
  }
}

const bytes = readFileSync(asset);
const uploadUrl = release.upload_url.replace(/\{.*\}$/, '');
const uploaded = await api(token, `${uploadUrl}?name=focus-reader-${tag}.zip`, {
  method: 'POST',
  headers: { 'content-type': 'application/zip' },
  body: bytes,
});

console.log(`  ✓ Release 已发布`);
console.log(`    ${release.html_url}`);
console.log(`  ✓ 已上传 ${uploaded.name}（${(statSync(asset).size / 1024).toFixed(1)} KB）`);
console.log(`    ${uploaded.browser_download_url}\n`);
