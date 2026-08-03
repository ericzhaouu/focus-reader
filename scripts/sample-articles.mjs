/**
 * Sample articles served locally so focus mode can be exercised without depending
 * on the network, and without the extension ever touching a real bookmark folder.
 */
import { createServer } from 'node:http';

const CSS = `
  body { max-width: 1100px; margin: 0 auto; padding: 24px; font-family: Georgia, 'Songti SC', serif; line-height: 1.7; color: #222; }
  nav { display: flex; gap: 16px; padding: 12px 0; border-bottom: 2px solid #ddd; margin-bottom: 24px; font-family: system-ui, sans-serif; }
  nav a { color: #06c; text-decoration: none; font-size: 14px; }
  .layout { display: grid; grid-template-columns: 1fr 260px; gap: 40px; }
  aside { font-family: system-ui, sans-serif; font-size: 13px; color: #666; }
  aside .ad { border: 1px dashed #f39; padding: 16px; margin-bottom: 16px; text-align: center; background: #fff0f6; }
  h1 { font-size: 30px; line-height: 1.3; }
  .byline { color: #888; font-size: 14px; font-family: system-ui, sans-serif; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 16px; color: #555; }
  pre { background: #f4f4f4; padding: 12px; overflow-x: auto; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; color: #999; font-size: 13px; }
`;

function page({ title, site, author, paragraphs, extras = '' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${title} - ${site}</title>
  <style>${CSS}</style>
</head>
<body>
  <nav><a href="/">首页</a><a href="/">专栏</a><a href="/">关于</a><a href="/">订阅</a></nav>
  <div class="layout">
    <article>
      <h1>${title}</h1>
      <p class="byline">${author} · ${site}</p>
      ${paragraphs.map((p) => `<p>${p}</p>`).join('\n      ')}
      ${extras}
    </article>
    <aside>
      <div class="ad">广告位 A<br />（专注模式应当移除此处）</div>
      <h3>热门推荐</h3>
      <ul><li>无关文章一</li><li>无关文章二</li><li>无关文章三</li></ul>
      <div class="ad">广告位 B</div>
    </aside>
  </div>
  <footer>版权所有 © ${site} · 这段页脚在专注模式下也应当消失</footer>
</body>
</html>`;
}

const P1 =
  '收藏一篇文章的那一刻，大脑会误以为自己已经读完了它。这种错觉几乎不需要成本：只要按下 Ctrl+D，一种「我已经掌握了这个知识」的满足感就会立刻兑现。心理学上把这叫做替代性完成——用一个廉价的动作，顶替掉那个昂贵的动作。于是收藏夹越来越长，真正读过的却寥寥无几。';
const P2 =
  '更麻烦的是，收藏夹本身会变成一种负担。每次打开它，几百条未读像一份永远交不掉的作业摆在面前。选择的成本高到让人干脆不选，最后的结果是：你既没有读，也没有删，只是让它继续堆着，并为此持续地感到轻微的愧疚。';
const P3 =
  '要打破这个循环，关键不在于把收藏整理得更整齐。分类、打标签、写笔记——这些都是在优化「收藏」这个动作本身，而收藏从来不是瓶颈。真正的瓶颈是注意力：你一次只能认真读一篇文章，但你的收藏夹一次向你展示五百篇。';
const P4 =
  '一个更有效的做法是限制供给。从收藏夹里随机抽出十篇，锁定，在读完之前不再显示任何新的东西。你依然可以无限收藏——那个习惯没必要改，也改不掉——但你的注意力被强制收敛到一个有限的、可完成的集合上。有限性本身就是一种解脱：十篇是能读完的，五百篇不是。';
const P5 =
  '这背后是一个更一般的原则：当选择的成本高于执行的成本时，减少选择比增加动力更有效。健身房的私教之所以有用，一半原因是他替你决定了今天练什么。番茄钟之所以有用，是因为它把「我要工作多久」这个问题从你手里拿走了。限制不是惩罚，它是把认知负担从你身上卸下来。';
const P6 =
  '值得强调的是，这种限制必须是软性的。如果一个工具真的阻止你收藏，你会在三天内卸载它——因为收藏那个动作本身提供了即时的心理回报，剥夺它只会带来对抗。正确的做法是让收藏保持自由，只在「读」这一侧建立秩序。你想存多少存多少，但你一次只能看见十篇。';
const P7 =
  '最后一点：读完之后要有一个明确的了结动作。把它移走、归档、划掉——形式不重要，重要的是那个动作让「读完」成为一个可见的事件。没有了结，阅读就没有边界，你会永远觉得自己还欠着什么。';

const ARTICLES = {
  '/a/why-we-save': page({
    title: '为什么我们收藏了却从不阅读',
    site: '慢读周刊',
    author: '林述',
    paragraphs: [P1, P2, P3, P4, P5, P6, P7],
    extras: `
      <h2>一个可以立刻试的做法</h2>
      <p>${P4}</p>
      <blockquote>限制不是惩罚，它是把认知负担从你身上卸下来。</blockquote>
      <p>${P7}</p>
    `,
  }),
  '/a/attention-budget': page({
    title: '注意力是有预算的',
    site: '深度阅读',
    author: '周衡',
    paragraphs: [P3, P5, P2, P6, P1, P4],
    extras: `
      <h2>预算的三种花法</h2>
      <p>${P7}</p>
      <pre><code>const batch = draw(bookmarks, 10);
lock(batch);            // 读完之前不解锁
archive(batch.read());  // 移动，不删除</code></pre>
      <p>${P5}</p>
    `,
  }),
  '/a/finishing': page({
    title: '论「读完」这件事',
    site: '纸上',
    author: '苏迟',
    paragraphs: [P7, P1, P6, P3, P2, P4, P5],
  }),
  '/a/short': `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>一个视频页 - 短内容站</title></head>
    <body><h1>这是一个几乎没有正文的页面</h1><p>用来验证专注模式的降级行为：正文太短时应保留原页，而不是渲染一个空白的阅读视图。</p></body></html>`,
};

const INDEX = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试文章站</title>
  <style>${CSS}</style></head><body><h1>Focus Reader 测试文章站</h1>
  <ul>${Object.keys(ARTICLES).map((p) => `<li><a href="${p}">${p}</a></li>`).join('')}</ul></body></html>`;

export function startArticleServer(port = 0) {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const body = path === '/' ? INDEX : ARTICLES[path];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

export const ARTICLE_PATHS = Object.keys(ARTICLES);
