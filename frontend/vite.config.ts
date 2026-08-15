import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Versiunea aplicației = sursa unică din tauri.conf.json (aceeași pe .exe/apk/web);
// data build-ului se ștampilează la fiecare compilare. Filigranate în app (Adrian,
// 7 iul: „să se vadă că update-ul s-a făcut") — apar pe TOATE shell-urile, fiindcă
// toate încarcă aceeași kelionai.app live.
let baseVersion = '1.0'
try {
  baseVersion = JSON.parse(readFileSync('../desktop/src-tauri/tauri.conf.json', 'utf8')).version || baseVersion
} catch { /* fallback pe constanta de mai sus */ }
const now = new Date()
const buildDate = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
// VERSIUNE CURATĂ, SEMANTICĂ (owner, 13 aug: „începi cu V1.0 și continuăm"). Nu mai
// lipim id-ul de build (YYMMDD.HHMM) — versiunea o bump-ăm manual la fiecare update
// (V1.0 → V1.1…), în tauri.conf.json (sursa unică). Ce se schimbă singur la fiecare
// publicare e DATA/ORA din filigran (din /api/version) + poarta de update, care se
// declanșează pe SHA-ul de deploy, nu pe string-ul versiunii.
const appVersion = baseVersion

// Dev: proxy auth + health to the Fastify backend on :8080 so the
// frontend stays single-origin (no CORS hassle, cookies just work).
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
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
  },
})
