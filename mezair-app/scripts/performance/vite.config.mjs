import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  root: fileURLToPath(new URL('./fixture', import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: { outDir: '/tmp/mezair-performance-fixture', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
});
