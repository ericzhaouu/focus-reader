import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the extension pages (reader, options) and the background service worker.
// The focus-mode content script is built separately by vite.content.config.ts,
// because it must be a self-contained classic script for chrome.scripting.executeScript.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
    rollupOptions: {
      input: {
        reader: 'reader.html',
        options: 'options.html',
        background: 'src/background/service-worker.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
