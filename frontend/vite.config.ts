import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Versiunea aplicației = sursa unică din tauri.conf.json (aceeași pe .exe/apk/web);
// data build-ului se ștampilează la fiecare compilare. Filigranate în app (Adrian,
// 7 iul: „să se vadă că update-ul s-a făcut") — apar pe TOATE shell-urile, fiindcă
// toate încarcă aceeași kelionai.app live.
let appVersion = '1.1.1'
try {
  appVersion = JSON.parse(readFileSync('../desktop/src-tauri/tauri.conf.json', 'utf8')).version || appVersion
} catch { /* fallback pe constanta de mai sus */ }
const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

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
})
