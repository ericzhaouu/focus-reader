/**
 * Headless smoke test for the batch state machine.
 *
 * The lock ("you cannot draw a new batch until this one is cleared") is the whole
 * product, so it gets exercised against an in-memory chrome.bookmarks /
 * chrome.storage mock rather than trusted to manual clicking.
 *
 * Run with: npm run smoke
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, '.tmp-smoke');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createChromeMock() {
  const areas = { local: {}, session: {} };
  const nodes = new Map();
  let seq = 0;
  nodes.set('0', { id: '0', title: '', children: true });

  const makeArea = (name) => ({
    async get(key) {
      const bag = areas[name];
      if (key === null || key === undefined) return clone(bag);
      const keys = Array.isArray(key) ? key : [key];
      const out = {};
      for (const k of keys) if (k in bag) out[k] = clone(bag[k]);
      return out;
    },
    async set(patch) {
      Object.assign(areas[name], clone(patch));
    },
    async remove(key) {
      for (const k of Array.isArray(key) ? key : [key]) delete areas[name][k];
    },
  });

  const childrenOf = (id) => [...nodes.values()].filter((n) => n.parentId === id);

  const bookmarks = {
    async getTree() {
      const buildNode = (id) => {
        const node = nodes.get(id);
        const kids = childrenOf(id);
        return {
          id: node.id,
          parentId: node.parentId,
          title: node.title,
          url: node.url,
          dateAdded: node.dateAdded,
          ...(node.url ? {} : { children: kids.map((k) => buildNode(k.id)) }),
        };
      };
      return [buildNode('0')];
    },
    async get(id) {
      const node = nodes.get(id);
      if (!node) throw new Error(`Can't find bookmark for id: ${id}`);
      return [clone(node)];
    },
    async getChildren(id) {
      if (!nodes.has(id)) throw new Error(`Can't find bookmark for id: ${id}`);
      return childrenOf(id).map((n) => clone(n));
    },
    async create({ parentId, title, url }) {
      const id = String(++seq + 1000);
      // Real Chrome stamps dateAdded at creation time, which is exactly what lets
      // archiving refresh an article's "saved on" date.
      const node = { id, parentId, title, url, dateAdded: Date.now() };
      nodes.set(id, node);
      return clone(node);
    },
    async move(id, { parentId }) {
      const node = nodes.get(id);
      if (!node) throw new Error('missing');
      node.parentId = parentId;
      return clone(node);
    },
    async remove(id) {
      if (!nodes.has(id)) throw new Error(`Can't find bookmark for id: ${id}`);
      for (const child of childrenOf(id)) nodes.delete(child.id);
      nodes.delete(id);
    },
  };

  return {
    chrome: { storage: { local: makeArea('local'), session: makeArea('session') }, bookmarks },
    nodes,
    seedFolder(parentId, title) {
      const id = String(++seq + 1000);
      nodes.set(id, { id, parentId, title });
      return id;
    },
    seedBookmark(parentId, title, url, dateAdded) {
      const id = String(++seq + 1000);
      nodes.set(id, { id, parentId, title, url, dateAdded });
      return id;
    },
    reset() {
      areas.local = {};
      areas.session = {};
    },
  };
}

const checks = [];
async function test(name, fn) {
  checks.push({ name, fn });
}

await build({
  configFile: false,
  logLevel: 'error',
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    minify: false,
    lib: { entry: 'scripts/smoke-entry.ts', formats: ['es'], fileName: () => 'lib.mjs' },
  },
});

const mock = createChromeMock();
globalThis.chrome = mock.chrome;

const lib = await import(pathToFileURL(resolve(OUT_DIR, 'lib.mjs')).href);

const BAR = mock.seedFolder('0', '书签栏');
let QUEUE = '';

function seedQueue(count) {
  mock.reset();
  for (const [id, node] of [...mock.nodes]) {
    if (id !== '0' && id !== BAR) mock.nodes.delete(id);
    else void node;
  }
  QUEUE = mock.seedFolder(BAR, '待读');
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(
      mock.seedBookmark(
        QUEUE,
        `文章 ${i + 1}`,
        `https://site${i % 4}.example.com/post-${i + 1}`,
        Date.now() - (count - i) * 86_400_000,
      ),
    );
  }
  return ids;
}

test('未配置文件夹时进入引导状态', async () => {
  seedQueue(3);
  const state = await lib.loadQueueState();
  assert.equal(state.kind, 'needs-setup');
});

test('非扩展环境使用英文 fallback 和动态占位符', async () => {
  assert.equal(lib.t('extensionName'), 'Focus Reader');
  assert.equal(
    lib.t('readerReadyText', [12, 5]),
    '12 articles are waiting. Drawing a batch will lock 5 until it is finished.',
  );
  assert.equal(lib.t('arcadeReadMoreUnlock', ['11.6k words', 'To Live']), 'Read 11.6k words more to unlock To Live');
});

test('新英文用户的默认归档文件夹名为 Read Archive', async () => {
  seedQueue(1);
  const config = await lib.getConfig();
  assert.equal(config.archiveFolderName, 'Read Archive');
});

test('配置指向不存在的文件夹时提示重新配置', async () => {
  seedQueue(3);
  await lib.patchConfig({ folderId: 'does-not-exist' });
  const state = await lib.loadQueueState();
  assert.equal(state.kind, 'folder-missing');
});

test('空文件夹进入空状态', async () => {
  seedQueue(0);
  await lib.patchConfig({ folderId: QUEUE });
  const state = await lib.loadQueueState();
  assert.equal(state.kind, 'empty-folder');
});

test('抽取一批并锁定：读完前不能再抽', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 10, strategy: 'random' });

  let state = await lib.loadQueueState();
  assert.equal(state.kind, 'no-batch');
  assert.equal(state.availableCount, 12);

  const drawn = await lib.drawBatch();
  assert.equal(drawn.ok, true);
  assert.equal(drawn.batch.items.length, 10);

  state = await lib.loadQueueState();
  assert.equal(state.kind, 'batch');
  assert.equal(state.unreadCount, 10);
  assert.equal(state.complete, false);
  assert.equal(state.availableCount, 2);

  const blocked = await lib.drawBatch();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'locked');
});

test('每天可以重选一次，跨天恢复', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 10 });
  await lib.drawBatch();

  let state = await lib.loadQueueState();
  assert.equal(state.canReroll, true);

  const rerolled = await lib.drawBatch({ reroll: true });
  assert.equal(rerolled.ok, true);

  state = await lib.loadQueueState();
  assert.equal(state.canReroll, false);
  assert.equal(state.rerollBlockedBy, 'used-today');

  const second = await lib.drawBatch({ reroll: true });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'reroll-used');

  // Simulate the clock rolling over to the next day.
  const stats = await lib.getStats();
  await lib.setStats({ ...stats, lastRerollDate: '2000-01-01' });

  state = await lib.loadQueueState();
  assert.equal(state.canReroll, true, '跨天后重选额度应恢复');
  assert.equal((await lib.drawBatch({ reroll: true })).ok, true);
});

test('已开始处理的批次不能整批重选', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 10 });
  const drawn = await lib.drawBatch();
  await lib.markRead(drawn.batch.items[0].bookmarkId);

  const state = await lib.loadQueueState();
  assert.equal(state.canReroll, false);
  assert.equal(state.rerollBlockedBy, 'already-started');

  const attempt = await lib.drawBatch({ reroll: true });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, 'already-started');
});

test('标记已读会把书签放进归档子文件夹，并刷新收藏时间', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 10, archiveFolderName: '已读归档' });
  const drawn = await lib.drawBatch();
  const target = drawn.batch.items[0];
  const originalAddedAt = target.addedAt;

  const before = await lib.listCandidates(QUEUE);
  assert.equal(before.length, 12);

  const result = await lib.markRead(target.bookmarkId);
  assert.equal(result.ok, true);

  const after = await lib.listCandidates(QUEUE);
  assert.equal(after.length, 11, '待读文件夹里应少一篇');

  const archive = (await chrome.bookmarks.getChildren(QUEUE)).find((n) => n.title === '已读归档');
  assert.ok(archive, '归档文件夹应被自动创建');
  const inside = await chrome.bookmarks.getChildren(archive.id);
  assert.equal(inside.length, 1, '文章应位于归档文件夹内');

  const archived = inside[0];
  assert.equal(archived.url, target.url, 'URL 必须保持一致');
  assert.equal(archived.title, target.title, '标题必须保持一致');
  assert.ok(
    archived.dateAdded > originalAddedAt,
    `归档副本的收藏时间应刷新为当下（原 ${originalAddedAt}，现 ${archived.dateAdded}）`,
  );
});

test('放弃会从收藏夹中真正删除该书签', async () => {
  seedQueue(8);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 4 });
  const drawn = await lib.drawBatch();
  const target = drawn.batch.items[0];

  const result = await lib.abandon(target.bookmarkId);
  assert.equal(result.ok, true);

  assert.equal(await lib.getNode(target.bookmarkId), null, '书签应已被删除');
  assert.equal((await lib.listCandidates(QUEUE)).length, 7);

  const state = await lib.loadQueueState();
  const item = state.batch.items.find((i) => i.bookmarkId === target.bookmarkId);
  assert.equal(item.status, 'abandoned');
  assert.equal(state.abandonedCount, 1);
  assert.equal(state.readCount, 0, '放弃不应计入已读');

  const stats = await lib.getStats();
  assert.equal(stats.totalAbandoned, 1);
  assert.equal(stats.totalRead, 0);
});

test('放弃的文章不阻塞批次完成', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();

  await lib.abandon(drawn.batch.items[0].bookmarkId);
  await lib.markRead(drawn.batch.items[1].bookmarkId);
  const last = await lib.markRead(drawn.batch.items[2].bookmarkId);

  assert.equal(last.complete, true);
  const state = await lib.loadQueueState();
  assert.equal(state.complete, true);
  assert.equal((await lib.drawBatch()).ok, true, '应可抽取下一批');
});

test('放弃后的文章不会再被抽中', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();
  const dropped = drawn.batch.items.map((i) => i.bookmarkId);
  for (const id of dropped) await lib.abandon(id);

  const next = await lib.drawBatch();
  for (const item of next.batch.items) {
    assert.equal(dropped.includes(item.bookmarkId), false);
  }
});

test('阅读字数按预估时长折算并累加', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();

  await lib.markRead(drawn.batch.items[0].bookmarkId);
  await lib.markRead(drawn.batch.items[1].bookmarkId);

  const stats = await lib.getStats();
  const expected = drawn.batch.items
    .slice(0, 2)
    .reduce((sum, item) => sum + lib.wordsFromMinutes(item.estimatedMinutes), 0);
  assert.equal(stats.totalWords, expected);
  assert.ok(expected > 0, '读完文章后街机分数应增加');
});

test('升级后忽略旧批次里由专注模式留下的 words', async () => {
  seedQueue(4);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 2 });
  const drawn = await lib.drawBatch();
  const item = drawn.batch.items[0];

  await lib.setCurrentBatch({
    ...drawn.batch,
    items: drawn.batch.items.map((entry) =>
      entry.bookmarkId === item.bookmarkId ? { ...entry, words: 999_999 } : entry,
    ),
  });
  await lib.markRead(item.bookmarkId);

  const stats = await lib.getStats();
  assert.equal(stats.totalWords, lib.wordsFromMinutes(item.estimatedMinutes));
  assert.notEqual(stats.totalWords, 999_999, '不可靠的旧抓取字数不应继续进入统计');
});

test('书籍等价换算的阶梯与进度', async () => {
  const none = lib.equivalenceFor(0);
  assert.equal(none.achieved, null);
  assert.equal(none.next.words, 8_000);

  const novel = lib.equivalenceFor(130_000);
  assert.equal(novel.achieved.id, 'to-live');
  assert.ok(novel.next.words > 130_000);

  const between = lib.equivalenceFor(28_500);
  assert.equal(between.achieved.id, 'little-prince');
  assert.equal(between.next.id, 'old-man-sea');
  assert.ok(between.ratio > 0 && between.ratio < 1);
  assert.equal(between.remaining, 50_000 - 28_500);

  // Past the top of the ladder it keeps counting in whole loops.
  const huge = lib.equivalenceFor(1_300_000 * 2 + 100);
  assert.equal(huge.loops, 2);
  assert.equal(huge.next, null);

  assert.equal(lib.formatWords(800), '800 words');
  assert.equal(lib.formatWords(13_000), '13k words');
});

test('街机 HUD 的关卡、分数与书架', async () => {
  assert.equal(lib.formatScore(0), '0000000');
  assert.equal(lib.formatScore(118_400), '0118400');

  assert.equal(lib.stageNumber(0), 1, '一本未通关时仍处于第 1 关');
  assert.equal(lib.clearedMilestones(0).length, 0);

  // 118,400 字越过了《局外人》(11 万) 但没到《活着》(13 万)。
  assert.equal(lib.stageNumber(118_400), 8);
  const cleared = lib.clearedMilestones(118_400);
  assert.equal(cleared.length, 7);
  assert.equal(cleared.at(-1).id, 'stranger');

  // 书架槽位数必须与阶梯长度一致，否则 UI 会漏掉里程碑。
  assert.equal(lib.MILESTONES.length, 17);
  assert.equal(lib.clearedMilestones(99_999_999).length, lib.MILESTONES.length);
});

test('清空整批后解锁并可抽下一批', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 10 });
  const drawn = await lib.drawBatch();
  for (const item of drawn.batch.items) await lib.markRead(item.bookmarkId);

  const state = await lib.loadQueueState();
  assert.equal(state.complete, true);
  assert.equal(state.readCount, 10);
  assert.equal(state.availableCount, 2);

  const next = await lib.drawBatch();
  assert.equal(next.ok, true);
  assert.equal(next.batch.items.length, 2, '剩余不足一批时有几篇抽几篇');

  const stats = await lib.getStats();
  assert.equal(stats.totalRead, 10);
  assert.equal(stats.streakDays, 1);
  assert.equal(stats.batchesCompleted, 1);
});

test('完成批次的计数在读完最后一篇时立即生效', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();

  await lib.markRead(drawn.batch.items[0].bookmarkId);
  assert.equal((await lib.getStats()).batchesCompleted, 0, '中途不应计数');

  await lib.markRead(drawn.batch.items[1].bookmarkId);
  const last = await lib.markRead(drawn.batch.items[2].bookmarkId);

  assert.equal(last.complete, true);
  assert.equal(
    (await lib.getStats()).batchesCompleted,
    1,
    '读完最后一篇即应计数，无需等到抽下一批',
  );
});

test('外部删除的书签会被判为失效，不再阻塞批次', async () => {
  seedQueue(4);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 4 });
  const drawn = await lib.drawBatch();
  const victim = drawn.batch.items[0];

  mock.nodes.delete(victim.bookmarkId);
  assert.equal(await lib.invalidateBookmark(victim.bookmarkId), true);

  for (const item of drawn.batch.items.slice(1)) await lib.markRead(item.bookmarkId);

  const state = await lib.loadQueueState();
  assert.equal(state.invalidCount, 1);
  assert.equal(state.readCount, 3);
  assert.equal(state.complete, true, '失效条目不应永久锁死批次');
});

test('批次进行中修改每批篇数不影响当前批次', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 10 });
  const drawn = await lib.drawBatch();
  assert.equal(drawn.batch.items.length, 10);

  await lib.patchConfig({ batchSize: 3 });
  const state = await lib.loadQueueState();
  assert.equal(state.batch.items.length, 10, '当前批次长度不变');
  assert.equal(state.batch.batchSize, 10);

  for (const item of state.batch.items) await lib.markRead(item.bookmarkId);
  const next = await lib.drawBatch();
  assert.equal(next.batch.items.length, 2, '下一批才使用新的篇数（此处剩余仅 2 篇）');
});

test('切换待读文件夹会丢弃过期批次', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 5 });
  await lib.drawBatch();

  const other = mock.seedFolder(BAR, '另一个待读');
  mock.seedBookmark(other, '别处的文章', 'https://other.example.com/a', Date.now());
  await lib.patchConfig({ folderId: other });

  const state = await lib.loadQueueState();
  assert.equal(state.kind, 'no-batch');
  assert.equal(state.availableCount, 1);
});

test('归档文件夹内的文章不会被再次抽中', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();
  for (const item of drawn.batch.items) await lib.markRead(item.bookmarkId);

  const next = await lib.drawBatch();
  const archived = new Set(drawn.batch.items.map((i) => i.bookmarkId));
  for (const item of next.batch.items) {
    assert.equal(archived.has(item.bookmarkId), false, '已归档的文章不应重新出现');
  }
});

test('每批篇数上限为 10', async () => {
  seedQueue(30);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 50 });
  const config = await lib.getConfig();
  assert.equal(config.batchSize, 10);
});

test('升级时旧 focusMode 配置会被丢弃', async () => {
  seedQueue(3);
  await chrome.storage.local.set({
    config: {
      folderId: QUEUE,
      batchSize: 3,
      strategy: 'random',
      archiveFolderName: '已读归档',
      focusMode: true,
    },
  });

  const config = await lib.getConfig();
  assert.equal('focusMode' in config, false);
  await lib.patchConfig({ batchSize: 2 });
  const stored = (await chrome.storage.local.get('config')).config;
  assert.equal('focusMode' in stored, false, '下一次设置写入应清除旧字段');
});

test('来源多样策略会尽量避开同一来源', async () => {
  seedQueue(0);
  const domains = ['alpha.com', 'beta.org', 'gamma.net'];
  for (let i = 0; i < 12; i++) {
    mock.seedBookmark(QUEUE, `文章 ${i}`, `https://${domains[i % 3]}/p${i}`, Date.now() - i * 1000);
  }
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3, strategy: 'domain-diversity' });
  const drawn = await lib.drawBatch();
  const picked = new Set(drawn.batch.items.map((i) => new URL(i.url).hostname));
  assert.equal(picked.size, 3, '三篇应来自三个不同来源');
});

test('同一站点的不同子域视为同一来源', async () => {
  seedQueue(0);
  const hosts = ['a.example.com', 'b.example.com', 'news.other.com'];
  for (let i = 0; i < 9; i++) {
    mock.seedBookmark(QUEUE, `文章 ${i}`, `https://${hosts[i % 3]}/p${i}`, Date.now() - i * 1000);
  }
  await lib.patchConfig({ folderId: QUEUE, batchSize: 2, strategy: 'domain-diversity' });
  const drawn = await lib.drawBatch();
  const roots = new Set(
    drawn.batch.items.map((i) => new URL(i.url).hostname.split('.').slice(-2).join('.')),
  );
  assert.equal(roots.size, 2, 'example.com 的两个子域应被合并成一个来源');
});

test('文件夹内重新排序不会把文章判为失效', async () => {
  seedQueue(5);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();
  const target = drawn.batch.items[0];

  // onMoved also fires for a plain re-order inside the same folder.
  const invalidated = await lib.invalidateBookmark(target.bookmarkId);
  assert.equal(invalidated, false);

  const state = await lib.loadQueueState();
  const item = state.batch.items.find((i) => i.bookmarkId === target.bookmarkId);
  assert.equal(item.status, 'unread');
});

test('归档产生的删除事件不会覆盖已读状态', async () => {
  seedQueue(5);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();
  const target = drawn.batch.items[0];

  await lib.markRead(target.bookmarkId);
  // Archiving re-creates the bookmark, so the original id is removed and
  // bookmarks.onRemoved fires — the background routes that here.
  assert.equal(await lib.invalidateBookmark(target.bookmarkId), false);

  const state = await lib.loadQueueState();
  const item = state.batch.items.find((i) => i.bookmarkId === target.bookmarkId);
  assert.equal(item.status, 'read', '已读状态不应被删除事件覆盖');
  assert.equal(state.readCount, 1);
});

test('AI 选文不出现在可选策略里，但契约仍然保留', async () => {
  assert.equal(
    lib.AVAILABLE_STRATEGIES.includes('ai'),
    false,
    'AI 尚未实现，不应出现在设置页下拉里',
  );
  assert.deepEqual(
    [...lib.AVAILABLE_STRATEGIES],
    ['random', 'oldest-first', 'domain-diversity', 'time-balanced'],
  );
  // The contract stays so v2 can switch it on without a schema change.
  assert.equal(lib.SELECTORS.ai.available, false);
  assert.equal(lib.effectiveStrategy('ai'), 'random', '存量配置应回落到随机');
  assert.equal(lib.effectiveStrategy('oldest-first'), 'oldest-first');
});

test('配置成 AI 时仍能正常抽取（回落到随机）', async () => {
  seedQueue(8);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3, strategy: 'ai' });
  const drawn = await lib.drawBatch();
  assert.equal(drawn.ok, true);
  assert.equal(drawn.batch.items.length, 3);
});

test('最早收藏优先策略确实先取最老的', async () => {
  const ids = seedQueue(8);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3, strategy: 'oldest-first' });
  const drawn = await lib.drawBatch();
  assert.deepEqual(
    drawn.batch.items.map((i) => i.bookmarkId),
    ids.slice(0, 3),
  );
});

test('并发抽取不会突破每日重选额度', async () => {
  seedQueue(12);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 4 });
  await lib.drawBatch();

  // Two reader tabs clicking reroll at the same moment.
  const results = await Promise.all([
    lib.drawBatch({ reroll: true }),
    lib.drawBatch({ reroll: true }),
  ]);
  const succeeded = results.filter((r) => r.ok);
  assert.equal(succeeded.length, 1, '只应有一次重选成功');

  const state = await lib.loadQueueState();
  assert.equal(state.canReroll, false);
  assert.equal(state.rerollBlockedBy, 'used-today');
  assert.equal(state.batch.items.length, 4, '批次不应被并发写坏');
});

test('并发标记已读不会互相覆盖', async () => {
  seedQueue(8);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 4 });
  const drawn = await lib.drawBatch();

  await Promise.all(drawn.batch.items.map((item) => lib.markRead(item.bookmarkId)));

  const state = await lib.loadQueueState();
  assert.equal(state.readCount, 4, '四篇都应记为已读');
  assert.equal(state.complete, true);
  assert.equal((await lib.getStats()).totalRead, 4, '统计不应丢失任何一次');
});

test('首次并发归档不会产生两个归档文件夹', async () => {
  seedQueue(8);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3, archiveFolderName: '已读归档' });
  const drawn = await lib.drawBatch();

  await Promise.all(drawn.batch.items.map((item) => lib.markRead(item.bookmarkId)));

  const folders = (await chrome.bookmarks.getChildren(QUEUE)).filter(
    (n) => !n.url && n.title === '已读归档',
  );
  assert.equal(folders.length, 1, '归档文件夹只应存在一个');
  const inside = await chrome.bookmarks.getChildren(folders[0].id);
  assert.equal(inside.length, 3, '三篇都应归入同一个文件夹');
});

test('worker 中途被杀导致状态未落盘时，下次加载会自愈为已读', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3, archiveFolderName: '已读归档' });
  const drawn = await lib.drawBatch();
  const target = drawn.batch.items[0];

  // Simulate the archive landing but the state write being lost to a worker teardown.
  const archiveId = await lib.findOrCreateArchiveFolder(QUEUE, '已读归档');
  await chrome.bookmarks.move(target.bookmarkId, { parentId: archiveId });

  const state = await lib.loadQueueState();
  const item = state.batch.items.find((i) => i.bookmarkId === target.bookmarkId);
  assert.equal(item.status, 'read', '已归档的文章应被判为已读，而不是失效');
  assert.equal(state.readCount, 1);
  assert.equal((await lib.getStats()).totalRead, 1, '丢失的阅读记录应被补回');
});

test('被移到其他位置的书签仍判为失效', async () => {
  seedQueue(6);
  await lib.patchConfig({ folderId: QUEUE, batchSize: 3 });
  const drawn = await lib.drawBatch();
  const target = drawn.batch.items[0];

  const elsewhere = mock.seedFolder(BAR, '别的地方');
  await chrome.bookmarks.move(target.bookmarkId, { parentId: elsewhere });

  const state = await lib.loadQueueState();
  const item = state.batch.items.find((i) => i.bookmarkId === target.bookmarkId);
  assert.equal(item.status, 'invalid');
  assert.equal((await lib.getStats()).totalRead, 0, '不应误记为已读');
});

let failures = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${error instanceof Error ? error.message : error}`);
  }
}

rmSync(OUT_DIR, { recursive: true, force: true });

console.log(`\n${checks.length - failures}/${checks.length} passed`);
process.exit(failures === 0 ? 0 : 1);
