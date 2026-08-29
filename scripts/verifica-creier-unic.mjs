#!/usr/bin/env node
// Poarta de arhitectură: în codul executabil există un singur furnizor AI
// online, OpenAI. Lista include și denumirile istorice ca să oprească atât
// importuri/config noi, cât și comentarii care descriu o cale retrasă ca vie.
// Modelele locale de avion (WebLLM/Whisper) și serviciile Google Workspace
// cerute explicit de utilizator nu sunt creier online și nu sunt interzise.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function tiparNumeFurnizor(nume) {
  const capitalizat = nume[0].toUpperCase() + nume.slice(1)
  // Prinde stringuri (`provider-name`), env (`PROVIDER_API_KEY`) și simboluri
  // CamelCase (`ProviderClient`), fără să confunde un prefix dintr-un cuvânt.
  return new RegExp(`\\b(?:${nume}|${nume.toUpperCase()}|${capitalizat})(?=$|[^A-Za-z0-9]|[A-Z])`)
}

const TIPARE_RETRASE = [
  ...['gemini', 'jules', 'devin', 'kimi', 'glm', 'openrouter', 'ollama', 'anthropic', 'claude', 'mistral', 'groq', 'deepseek']
    .map((nume) => ({ nume, re: tiparNumeFurnizor(nume) })),
  // Prinde și cablajul Ollama mascat sub un nume generic: portul implicit sau
  // API-ul local specific. Numele furnizorului poate lipsi complet din cod.
  // „version" este exclus din potrivirea bazată pe URL, deoarece /api/version
  // este și endpoint-ul de health al aplicației proprii (port 8080 / 18080);
  // portul 11434 rămâne prins prin \b11434\b, indiferent de cale.
  {
    nume: 'ollama-transport',
    re: /\b11434\b|(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(?::\d+)?\/api\/(?:chat|generate|tags|show|pull|push|create|copy|delete|embed|embeddings|ps|blobs)\b/i,
  },
  // Nume ambigue în limbaj natural: le prindem numai în forma de produs/config.
  { nume: 'together-ai', re: /\btogether\.ai\b|\bTOGETHER_(?:API|KEY|MODEL)\b|\bprovider[^\n]{0,30}\btogether\b/i },
  { nume: 'veo', re: /\bveo[-_]\d|\bVEO_(?:API|KEY|MODEL)\b|\bGoogle[^\n]{0,30}\bVeo\b|\bveoModel\b/i },
  { nume: 'chirp', re: /\bchirp[-_]\d|\bCHIRP_(?:API|KEY|MODEL)\b|\bGoogle[^\n]{0,30}\bChirp\b|\b(?:gura|ureche)Chirp\b/i },
  // A local/offline speech engine may live on the end-user device. A server
  // URL, container or HTTP route would turn it into a second online AI path
  // and would upload biometric voice samples outside the OpenAI-only boundary.
  {
    nume: 'coqui-server',
    re: /\bCOQUI_(?:URL|ENABLE|MODEL)|\bkelion-coqui\b|\bDockerfile\.coqui\b|\/api\/voce\/(?:coqui-status|sintetizeaza|sample)\b/i,
  },
]

const EXTENSII = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.sh', '.toml'])
const RADACINI = ['backend/src/', 'frontend/src/', 'deploy/', '.github/workflows/', 'scripts/', 'android/', 'ios/', 'desktop/']
const EXCLUSE = new Set([
  'scripts/verifica-creier-unic.mjs',
  'scripts/verifica-creier-unic.test.mjs',
  'backend/package-lock.json',
  'frontend/package-lock.json',
  'android/package-lock.json',
  'ios/package-lock.json',
  'desktop/package-lock.json',
  'desktop/src-tauri/Cargo.lock',
])

function snapshotGit() {
  const raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  return raw.toString('utf8').split('\0').filter(Boolean)
}

function esteInSuprafata(cale) {
  if (EXCLUSE.has(cale) || !existsSync(cale)) return false
  if (cale === 'Dockerfile' || cale.startsWith('Dockerfile.')) return true
  if (cale.endsWith('/package.json')) return true
  return RADACINI.some((rad) => cale.startsWith(rad)) && EXTENSII.has(extname(cale).toLowerCase())
}

export function gasesteFurnizoriRetrasi(fisiere = snapshotGit()) {
  const abateri = []
  for (const cale of fisiere.filter(esteInSuprafata)) {
    const linii = readFileSync(cale, 'utf8').replace(/\r\n/g, '\n').split('\n')
    for (let index = 0; index < linii.length; index++) {
      const gasite = new Set(furnizoriRetrasiInLinie(linii[index]))
      if (gasite.size) abateri.push({ cale, linie: index + 1, termeni: [...gasite].sort() })
    }
  }
  return abateri
}

export function furnizoriRetrasiInLinie(linie) {
  return TIPARE_RETRASE.filter(({ re }) => re.test(linie)).map(({ nume }) => nume)
}

const rulatDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (rulatDirect) {
  const abateri = gasesteFurnizoriRetrasi()
  if (abateri.length) {
    console.error(`Creier unic: ${abateri.length} linii mai conțin furnizori/căi AI retrase:`)
    for (const abatere of abateri) {
      console.error(`  ${abatere.cale}:${abatere.linie} — ${abatere.termeni.join(', ')}`)
    }
    process.exit(1)
  }

  console.log('Creier unic: 0 furnizori AI online alternativi în cod/config.')
}
