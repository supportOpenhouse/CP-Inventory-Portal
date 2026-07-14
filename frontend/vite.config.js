import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'CP OpenHouse', short_name: 'CP OpenHouse',
        theme_color: '#FF6B2B', display: 'standalone', start_url: '/',
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
