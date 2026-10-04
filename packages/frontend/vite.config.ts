import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs on :8787 locally (npm run dev:backend); same-origin in AWS via CloudFront.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
