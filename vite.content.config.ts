import { defineConfig } from 'vite';

// The focus-mode reader view is injected with chrome.scripting.executeScript,
// which only accepts classic (non-module) scripts. It therefore has to be bundled
// as a single self-contained IIFE with no imports and no separate CSS asset.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/focus/inject.ts',
      formats: ['iife'],
      name: '__focusReaderInject',
      fileName: () => 'focus-inject.js',
    },
  },
});
