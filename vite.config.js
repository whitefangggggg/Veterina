import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'pwa/*.png'],
    manifest: {
      id: '/',
      name: 'Veterina Clinic Care',
      short_name: 'Veterina',
      description: 'Veterinary clinic care, patients, appointments and records.',
      lang: 'en',
      start_url: '/dashboard',
      scope: '/',
      display: 'standalone',
      background_color: '#f6f8f5',
      theme_color: '#173f37',
      icons: [
        { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Only public build assets are cached. Auth, clinic data and mutations stay on the network.
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      cleanupOutdatedCaches: true,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/\.well-known\//],
      runtimeCaching: [],
    },
    devOptions: {
      enabled: true,
      // Keep installability on localhost without intercepting development pages or HMR.
      navigateFallbackAllowlist: [],
      disableRuntimeConfig: true,
      suppressWarnings: true,
    },
  })],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js','supabase/functions/_shared/**/*.test.ts'],
  },
})
