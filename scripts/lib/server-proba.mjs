// ── SERVERUL DE PROBĂ: PORNIT CU MEDIU CURĂȚAT ───────────────────────────────
//
// DE CE EXISTĂ FIȘIERUL ĂSTA (măsurat, 8 aug 2026, nu presupus):
//
// Prima probă de rute pornea serverul cu `env: { ...process.env }`. Am măsurat
// ce e în mediul în care rulează probele și am găsit, printre altele:
//
//     GITHUB_TOKEN=…        CLOUDSDK_AUTH_ACCESS_TOKEN=…       AWS_SECRET_ACCESS_KEY=…
//
// Iar `POST /api/admin/reset-vps` face exact asta:
//
//     await runRunbook('restart-app')   →  workflow_dispatch pe kelion-team/kelionai
//
// și `runRunbook` se oprește DOAR pe `if (!ghToken())`. Cu tokenul moștenit, o
// probă de scriere ar fi repornit aplicația de PRODUCȚIE. Adrian, 8 aug:
// „o distrugi se închide imediat proiectul". Nu-i o ipoteză — tokenul chiar era
// acolo, l-am citit.
//
// Deci: serverul de probă primește o LISTĂ ALBĂ de variabile, nimic altceva.
// Fără credențiale, nicio rută nu poate atinge nimic real — GitHub refuză,
// Google refuză, Stripe refuză, poșta refuză. Asta transformă rutele
// distructive în rute probabile: fac exact drumul lor prin cod, dar mâna lor
// nu ajunge nicăieri.
//
// AUTO-VERIFICARE: dacă în mediul construit aici apare vreun nume care miroase
// a credențial, probele NU pornesc — ies cu 2 („nu pot verifica"). Un gard care
// se poate strica în tăcere nu e gard.
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

export const RADACINA = new URL('../..', import.meta.url).pathname

/** Numele care nu au ce căuta lângă un server de probă. */
const MIROASE_A_CREDENTIAL = /(TOKEN|KEY|SECRET|PASSW|CREDENTIAL|AUTH|DATABASE_URL|DSN|COOKIE|SESSION)/i

/** Singurele variabile care trec. Nimic din ele nu deschide nicio ușă. */
const PERMISE = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR']

/**
 * Mediul serverului de probă: lista albă + cele trei valori generate acum.
 * `SESSION_SECRET` e singura excepție de la regula de mai sus — e generat aici,
 * există zece minute și nu deschide decât ușa instanței noastre locale.
 */
export function mediuCurat({ port, secret, email }) {
  const env = { NODE_ENV: 'production', PORT: String(port), SESSION_SECRET: secret, ADMIN_EMAIL: email }
  for (const n of PERMISE) if (process.env[n] != null) env[n] = process.env[n]

  const scapate = Object.keys(env).filter((n) => n !== 'SESSION_SECRET' && MIROASE_A_CREDENTIAL.test(n))
  if (scapate.length) {
    throw new Error(`mediul de probă conține nume de credențial: ${scapate.join(', ')}`)
  }
  return env
}

/** Un bilet de admin semnat cu secretul generat acum, valabil pe instanța noastră. */
export function semneazaBilet({ secret, email }) {
  const require_ = createRequire(path.join(RADACINA, 'backend/package.json'))
  const jwt = require_('jsonwebtoken')
  const bilet = jwt.sign({ email, role: 'admin' }, secret, { expiresIn: '10m' })
  return `kelionai_session=${encodeURIComponent(bilet)}`
}

/** Secret de unică folosință: nu se apropie niciodată de vreo valoare reală. */
export const secretDeProba = () => `proba-${Math.random().toString(36).slice(2)}-${Date.now()}`

async function asteapta(url, secunde) {
  for (let i = 0; i < secunde * 2; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (r.status) return true
    } catch {
      /* încă nu s-a ridicat */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/**
 * Pornește `backend/dist/index.js` pe portul dat, cu mediul curățat, și
 * așteaptă să răspundă. Întoarce `{ ok, opreste, iesire, cookie, env }`.
 * Dacă nu se ridică, `ok` e false și `iesire` are ultimele rânduri — apelantul
 * trebuie să iasă cu 2, nu să raporteze „0 probleme".
 */
export async function porneste({ port, secunde = 40 }) {
  const secret = secretDeProba()
  const email = 'proba-admin@local.test'
  const env = mediuCurat({ port, secret, email })

  const server = spawn('node', ['dist/index.js'], {
    cwd: path.join(RADACINA, 'backend'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let iesire = ''
  server.stdout.on('data', (d) => (iesire += String(d)))
  server.stderr.on('data', (d) => (iesire += String(d)))

  const opreste = () => {
    try {
      server.kill('SIGKILL')
    } catch {
      /* deja oprit */
    }
  }
  process.on('exit', opreste)

  const ok = await asteapta(`http://127.0.0.1:${port}/api/health`, secunde)
  return { ok, opreste, iesire: () => iesire, cookie: semneazaBilet({ secret, email }), env, email }
}
