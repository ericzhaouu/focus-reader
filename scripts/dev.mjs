/** Builds once, then watches the extension pages and service worker. */
import { build } from 'vite';

await build({ configFile: 'vite.config.ts' });

console.log('\n初次构建完成 → dist/');
console.log('在 chrome://extensions 打开开发者模式，选择「加载已解压的扩展程序」并指向 dist/\n');

await build({ configFile: 'vite.config.ts', build: { watch: {}, emptyOutDir: false } });
