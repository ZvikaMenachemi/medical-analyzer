import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// In GitHub Actions: VITE_BASE_URL is set to "/<repo-name>/"
// In local dev: defaults to "/"
const base = process.env.VITE_BASE_URL ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.svg'],
      manifest: {
        name: 'מנתח בדיקות רפואיות',
        short_name: 'מנתח בדיקות',
        description: 'עקוב אחר תוצאות הבדיקות הרפואיות שלך לאורך זמן',
        theme_color: '#1a6fc4',
        background_color: '#f0f4f8',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'he',
        dir: 'rtl',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache app shell, JS/CSS bundles, and WASM assets
        globPatterns: ['**/*.{js,css,html,svg,wasm,mjs}'],
        // Don't precache the huge pdf.worker — it's loaded on demand
        globIgnores: ['**/pdf.worker*'],
        runtimeCaching: [
          {
            // pdf.worker served from same origin — cache with network-first
            urlPattern: /pdf\.worker/,
            handler: 'NetworkFirst',
            options: { cacheName: 'pdf-worker', expiration: { maxEntries: 1 } },
          },
        ],
        // Allow large WASM/JS files in the precache manifest
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  optimizeDeps: {
    include: ['sql.js'],
  },
  assetsInclude: ['**/*.wasm'],
})
