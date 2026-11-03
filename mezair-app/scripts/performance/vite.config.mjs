import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  worker: { format: 'es' },
  base: './',
  root: fileURLToPath(new URL('./fixture', import.meta.url)),
  plugins: [
    {
      name: 'fixture-render-counts',
      enforce: 'pre',
      transform(source, id) {
        if (!id.endsWith('/chat/ChatInput.tsx')) return;
        return source.replace(
          '}: ChatInputProps) {',
          `}: ChatInputProps) {
 globalThis.__MEZAIR_PERF_RENDER_COUNTS__?.('ChatInput');`,
        );
      },
    },
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: process.env.PERF_OUT_DIR ?? join(tmpdir(), 'mezair-performance-fixture'),
    emptyOutDir: true,
  },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
});
