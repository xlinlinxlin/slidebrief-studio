import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'bundle', assetsInlineLimit: 0 },
});
