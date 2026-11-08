import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { reviewContextMocks } from './chat-review-fixture/context-mocks.mjs';
export default defineConfig({
  worker: { format: 'es' },
  base: './',
  root: fileURLToPath(new URL('./chat-review-fixture', import.meta.url)),
  plugins: [reviewContextMocks(), react(), tailwindcss()],
  define: {
    'process.env.MEZAIR_BUILD_BRAND': JSON.stringify('mezair'),
    'process.env.MEZAIR_PREVIEW_BUILD': JSON.stringify(''),
  },
  build: {
    minify: false,
    rollupOptions: {
      input: {
        review: fileURLToPath(new URL('./chat-review-fixture/index.html', import.meta.url)),
        chatView: fileURLToPath(new URL('./chat-review-fixture/chat-view.html', import.meta.url)),
      },
    },
    outDir: process.env.REVIEW_FIXTURE_OUT ?? '/tmp/mezair-chat-review-fixture',
    emptyOutDir: true,
  },
});
