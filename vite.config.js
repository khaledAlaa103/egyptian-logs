import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // the app shows "update available"; nothing reloads under the user's feet
      injectRegister: false, // registered by src/pwa/register.js
      includeAssets: ['icons/favicon-48.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'WellLog Pro',
        short_name: 'WellLog',
        description: 'Well logging interpretation and groundwater analysis – works offline',
        lang: 'en',
        theme_color: '#0b1f3a',
        background_color: '#0b1f3a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['productivity', 'utilities', 'science'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // everything the app needs is precached: JS/CSS/HTML, icons and the bundled PDF worker
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,webmanifest,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html', // the app uses hash routes, so every navigation is index.html
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
    }),
  ],
  base: './', // relative paths: works in Electron (file://) and static hosting
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    testTimeout: 20000,
    retry: 1, // safety net only: the inline-editor race that needed retries was fixed (see docs, Phase 9)
  },
});
