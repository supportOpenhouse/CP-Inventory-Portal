import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Build identity, stamped at build time (epoch ms). The version guard
  // compares it to the server's force_reload_after threshold to decide whether
  // this build is stale enough to force-reload. Replaced inline at build.
  define: {
    __BUILD_TIME__: JSON.stringify(Date.now()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': the new worker WAITS instead of calling
      // skipWaiting. That keeps the currently-loaded build's precached chunks
      // intact, so an open tab stays healthy until the user accepts the update
      // via <UpdateBanner />. With autoUpdate the new worker takes over
      // immediately and evicts the old chunks, leaving the still-running page
      // one lazy navigation away from a "failed to fetch module" crash.
      registerType: 'prompt',
      manifest: {
        name: 'CP OpenHouse', short_name: 'CP OpenHouse',
        // Matches index.html's light --bg. The manifest colour is static (it
        // dresses the install splash); the live browser strip is driven by
        // ThemeContext rewriting the theme-color meta per theme.
        theme_color: '#f6f5f3', display: 'standalone', start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // The CometChat UIKit bundle is large (>2 MiB); raise the precache
        // cap so the SW build doesn't drop it from the manifest.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      // Dev SW disabled: a dev service worker precaches the app and serves
      // stale/broken content on reload (the "blank screen, stuck on Loading"
      // symptom). The SW still ships in production builds (autoUpdate).
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true, cookieDomainRewrite: 'localhost' },
    },
  },
});
