import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Versiunea aplicației = sursa unică din tauri.conf.json (aceeași pe .exe/apk/web);
// data build-ului se ștampilează la fiecare compilare. Filigranate în app (Adrian,
// 7 iul: „să se vadă că update-ul s-a făcut") — apar pe TOATE shell-urile, fiindcă
// toate încarcă aceeași kelionai.app live.
let baseVersion = '1.1.1'
try {
  baseVersion = JSON.parse(readFileSync('../desktop/src-tauri/tauri.conf.json', 'utf8')).version || baseVersion
} catch { /* fallback pe constanta de mai sus */ }
const now = new Date()
const buildDate = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
// Filigranul trebuie să reflecte VERSIUNEA LIVE, permanent (Adrian, 9 iul): pe
// lângă versiunea semantică, lipim un id de build derivat din momentul compilării
// (YYMMDD.HHMM), unic la fiecare deploy — așa versiunea din filigran se schimbă
// singură de fiecare dată când iese cod nou pe live, fără bump manual.
const p = (n: number): string => String(n).padStart(2, '0')
const buildId =
  `${String(now.getUTCFullYear()).slice(2)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
  `.${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
const appVersion = `${baseVersion}+${buildId}`

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
