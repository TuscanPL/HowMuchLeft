import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Short commit hash: GitHub Actions' GITHUB_SHA, else git, else "dev". APP_VERSION overrides. */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // GitHub Pages serves the app at /<repo>/; custom domains override VITE_BASE.
  const rawBase = env.VITE_BASE || '/'
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
      vue(),
      tailwindcss(),
      VitePWA({
        // New versions wait for the "Update" banner (lib/appUpdate.ts registers the worker).
        registerType: 'prompt',
        injectRegister: false,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: base,
          name: 'HowMuchLeft',
          short_name: 'HowMuchLeft',
          description: 'What we can still spend this month.',
          theme_color: '#047857',
          background_color: '#f8fafc',
          display: 'standalone',
          scope: base,
          start_url: base,
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5173 },
  }
})
