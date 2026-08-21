import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

// ── WASM ONNXRUNTIME SERVIT LOCAL (Faza 1 · M4/M5, urechea + văzul offline) ──
// transformers.js (Whisper/captioning) rulează pe onnxruntime-web, care implicit își ia
// runtime-ul de pe un CDN — BLOCAT offline + de CSP. Îl servim LOCAL, la `/ort/`: în dev
// printr-un middleware, la build copiat în `dist/ort/`. NU intră în git (generat din
// node_modules). SW-ul îl cache-uiește la cerere (vezi sw.js).
//
// BUG REPARAT (owner 21 aug, PROBĂ LIVE: „no available backend found ... Failed to fetch
// dynamically imported module: .../ort/ort-wasm-simd-threaded.asyncify.mjs"): copiam DOAR
// 2 fișiere `.wasm` și serveam ZERO fișiere `.mjs`. Dar onnxruntime-web încarcă MAI ÎNTÂI
// un modul JS glue (`.mjs`) prin import dinamic, care apoi aduce `.wasm`-ul lui; iar
// varianta pe care o cere efectiv (asyncify = calea WASM cu UN fir, fără cross-origin
// isolation) nu era nici copiată, nici servită → 404 → urechea + văzul MUREAU. Regula #1:
// nu ghicim ce variantă alege browserul/ORT → copiem + servim TOATE (`.mjs` ȘI `.wasm`),
// enumerate din dist (se adaptează singur la un update de onnxruntime-web).
const require = createRequire(import.meta.url)
function ortDir(): string {
  return require.resolve('onnxruntime-web').replace(/[/\\]dist[/\\].*$/, '/dist')
}
// Toate runtime-urile ORT (fiecare variantă: `.mjs` loader + `.wasm` binar) — enumerate
// din node_modules ca să nu ratăm nicio variantă (base/jsep/asyncify/jspi).
function fisiereOrt(): string[] {
  try {
    return readdirSync(ortDir()).filter((f) => /^ort-wasm-.*\.(mjs|wasm)$/.test(f))
  } catch {
    return []
  }
}
const tipContinutOrt = (f: string): string => (f.endsWith('.mjs') ? 'text/javascript' : 'application/wasm')
function servesteWasmOrt(): Plugin {
  return {
    name: 'kelion-ort-wasm-local',
    // DEV: servește /ort/*.{mjs,wasm} direct din node_modules.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url && /^\/ort\/([\w.-]+\.(?:mjs|wasm))(?:\?|$)/.exec(req.url)
        if (!m) return next()
        try {
          const buf = readFileSync(`${ortDir()}/${m[1]}`)
          res.setHeader('Content-Type', tipContinutOrt(m[1]))
          res.end(buf)
        } catch {
          next()
        }
      })
    },
    // BUILD: copiază TOATE runtime-urile (loader-e .mjs + binare .wasm) în dist/ort/.
    writeBundle(options) {
      const outDir = options.dir ?? 'dist'
      const dst = `${outDir}/ort`
      try {
        mkdirSync(dst, { recursive: true })
        for (const f of fisiereOrt()) {
          const src = `${ortDir()}/${f}`
          if (existsSync(src)) copyFileSync(src, `${dst}/${f}`)
        }
      } catch {
        /* dacă node_modules lipsește la build, urechea/văzul nu vor merge — se vede la probă */
      }
    },
  }
}

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
  plugins: [react(), servesteWasmOrt()],
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
