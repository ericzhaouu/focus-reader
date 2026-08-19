/**
 * Watch mode. The two Vite configs share dist/, so the initial clean build runs
 * first and the watchers afterwards never empty the directory out from under
 * each other.
 */
import { build } from 'vite';

await build({ configFile: 'vite.config.ts' });
await build({ configFile: 'vite.content.config.ts' });

console.log('\n初次构建完成 → dist/');
console.log('在 chrome://extensions 打开开发者模式，选择「加载已解压的扩展程序」并指向 dist/\n');

await Promise.all([
  build({ configFile: 'vite.config.ts', build: { watch: {}, emptyOutDir: false } }),
  build({ configFile: 'vite.content.config.ts', build: { watch: {} } }),
]);
