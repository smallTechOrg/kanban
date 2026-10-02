import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The API origin the dev server proxies to (Section 1.8); production is same-origin. */
const API_ORIGIN = 'http://127.0.0.1:8000';

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin stays false so the kb_session cookie remains first-party.
      '/api': { target: API_ORIGIN, changeOrigin: false },
      '/uploads': { target: API_ORIGIN, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
