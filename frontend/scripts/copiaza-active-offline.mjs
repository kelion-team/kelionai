// ── ACTIVELE KITULUI OFFLINE, COPIATE DIN node_modules LA BUILD ─────────────
//
// Kitul offline (gura Piper + urechea Whisper — ordinul din 22 aug: „auto
// download invizibil cu toate") are nevoie de runtime-urile WASM servite DE PE
// DOMENIUL NOSTRU: implicit, piper-tts-web le-ar lua de pe cdnjs/jsdelivr la
// fiecare pornire rece — adică exact o dependență de internet în mijlocul
// modului OFFLINE, plus CDN-uri străine (lecția căderii ONNX din 21 aug:
// versiuni fixate, servite de noi).
//
// De ce COPIE la build și nu fișiere în git: ~50 MB de binare ar umfla repo-ul
// pentru totdeauna; ele EXISTĂ deja în node_modules (versiuni fixate în
// package-lock), și build-ul (local sau Docker) rulează oricum npm install.
// Scriptul e chemat din `npm run build` (și `predev`) — dacă lipsesc sursele,
// PICĂ TARE (exit 1), nu lasă un build fără kit.
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const radacina = join(dirname(fileURLToPath(import.meta.url)), '..')

// Setul minim pe care backend-ul WASM al ORT 1.18 îl poate cere (simd
// threaded/nethreaded + fallback fără simd). JSEP/training NU — Piper merge pe
// CPU-wasm, nu pe WebGPU.
const ACTIVE = [
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'public/ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm', 'public/ort/ort-wasm-simd.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm.wasm', 'public/ort/ort-wasm.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'public/piper/piper_phonemize.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'public/piper/piper_phonemize.data'],
]

let copiate = 0
for (const [sursa, tinta] of ACTIVE) {
  const de = join(radacina, sursa)
  const la = join(radacina, tinta)
  try {
    await stat(de)
  } catch {
    console.error(`[kit-offline] LIPSĂ sursa ${sursa} — rulează npm install (versiunile sunt fixate în lock)`)
    process.exit(1)
  }
  await mkdir(dirname(la), { recursive: true })
  // Copiem doar dacă ținta lipsește sau diferă ca mărime (build repetat = ieftin).
  try {
    const [a, b] = [await stat(de), await stat(la)]
    if (a.size === b.size) continue
  } catch {
    /* ținta nu există încă */
  }
  await copyFile(de, la)
  copiate++
}
console.log(`[kit-offline] active pe loc (${copiate} copiate acum, restul erau la zi)`)
