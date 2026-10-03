import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const API_URL = 'http://127.0.0.1:8787';

// The dev server serves the Preact app on 5173 and proxies API calls to the Hono server so the
// client can keep using same-origin `/api` paths in development and production.
export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
