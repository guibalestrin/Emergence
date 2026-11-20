import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is a single self-contained HTML file (dist/index.html)
// that works offline by double-clicking it — ideal for a demo laptop at an expo.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  worker: { format: 'iife' },
});
