/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const FAKE_SDK_PATH = '/__dev/fake-spotify-player.js';

/**
 * `vite --mode demo` (pnpm dev:demo): serve a fake Spotify Web Playback SDK
 * so the in-browser player works against the backend's fake Spotify. Nothing
 * of this ends up in a production build.
 */
function fakeSpotifySdk(): Plugin {
  return {
    name: 'fake-spotify-sdk',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(FAKE_SDK_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(new URL('./dev/fake-spotify-player.js', import.meta.url)));
      });
    },
  };
}

/** In GitHub Codespaces, the forwarded URLs (https://<codespace>-5173.app.github.dev) reach the dev server. */
const codespacesDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;

// The API runs on :8787 locally (pnpm dev:backend); same-origin in AWS via CloudFront.
export default defineConfig(({ mode }) => {
  if (mode === 'demo') process.env.VITE_SPOTIFY_SDK_URL = FAKE_SDK_PATH;
  return {
    plugins: [react(), ...(mode === 'demo' ? [fakeSpotifySdk()] : [])],
    server: {
      host: '127.0.0.1',
      port: 5173,
      allowedHosts: codespacesDomain ? [`.${codespacesDomain}`] : [],
      proxy: {
        '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/support/setup.ts'],
      // Measured only with `pnpm test:coverage` (CI on Ubuntu).
      coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'json-summary', 'html'] },
    },
  };
});
