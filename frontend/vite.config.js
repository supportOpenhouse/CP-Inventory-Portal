import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'maskable-icon-512.png'],
      manifest: {
        name: 'CP OpenHouse',
        short_name: 'CP OpenHouse',
        description: 'CP OpenHouse inventory portal',
        theme_color: '#FF6B2B',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: 'localhost',
    // Proxy /api to the Flask backend so dev is SAME-ORIGIN — the session
    // cookie is then first-party (SameSite=Lax works over http). Mirrors the
    // prod Vercel rewrite. cookieDomainRewrite re-scopes the backend's cookie
    // to localhost so the browser stores it.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        cookieDomainRewrite: 'localhost',
      },
    },
  },
});