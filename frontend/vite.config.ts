import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const productConfig = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8')) as Record<string, unknown>
const endpointConfig = JSON.parse(readFileSync(new URL('../config/endpoints.json', import.meta.url), 'utf8')) as {
  external?: Record<string, unknown>
}
const productOrigin = new URL(String(productConfig.publicAppOrigin ?? ''))
if (productOrigin.protocol !== 'https:' || productOrigin.username || productOrigin.password || productOrigin.pathname !== '/' || productOrigin.search || productOrigin.hash) {
  throw new Error('config/product.json: publicAppOrigin invalid')
}
for (const field of ['appName', 'appVersion', 'githubRepository', 'supportEmail', 'nativeScheme', 'androidApplicationId', 'iosBundleId', 'iosTeamId', 'desktopBundleId']) {
  if (typeof productConfig[field] !== 'string' || !productConfig[field]) throw new Error(`config/product.json: ${field} invalid`)
}
if (!Array.isArray(productConfig.nativeOrigins) || typeof productConfig.nativeRedirects !== 'object' || productConfig.nativeRedirects === null) {
  throw new Error('config/product.json: native auth config invalid')
}

const now = new Date()
const buildDate = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const appVersion = String(productConfig.appVersion)
const checkoutOrigins = [
  endpointConfig.external?.revolutCheckoutProductionOrigin,
  endpointConfig.external?.revolutCheckoutSandboxOrigin,
].map((raw) => {
  const url = new URL(String(raw ?? ''))
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) throw new Error('config/endpoints.json: Revolut checkout origin invalid')
  return url.origin
})

// Dev: proxy auth + health to the Fastify backend on :8080 so the
// frontend stays single-origin (no CORS hassle, cookies just work).
export default defineConfig({
  // Gate/release images mount node_modules read-only. Keep every Vite cache in
  // the writable worktree; the native config loader also avoids .vite-temp.
  cacheDir: '.tmp/vite-cache',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
    __PRODUCT_CONFIG__: JSON.stringify(productConfig),
    __CHECKOUT_ORIGINS__: JSON.stringify(checkoutOrigins),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8080',
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')
          if (
            moduleId.includes('/node_modules/@mlc-ai/') ||
            moduleId.includes('/node_modules/@huggingface/transformers/') ||
            moduleId.includes('/node_modules/onnxruntime-')
          ) return 'offline-runtime'
          return undefined
        },
      },
    },
  },
})
