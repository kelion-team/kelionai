#!/usr/bin/env node
/**
 * Poartă pentru valori operaționale sau comerciale împrăștiate prin cod.
 *
 * Configurația declarativă este permisă; valorile copiate în call-site-uri nu
 * sunt. Excepțiile sunt rezervate constantelor tehnice imuabile și trebuie
 * explicate pe aceeași linie cu `hardcod-permis: motiv concret`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RADACINA = fileURLToPath(new URL('..', import.meta.url))
const EXTENSII = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.sh', '.py', '.rs', '.java', '.toml'])
const RADACINI = ['backend/src/', 'frontend/src/', 'deploy/', '.github/workflows/', 'scripts/', 'android/', 'ios/', 'desktop/']
const CONFIG_CENTRAL = new Set([
  'config/product.json',
  'backend/.env.example',
  'deploy/kelionai.env.example',
  'deploy/host.env.example',
])
const EXCLUSE = new Set([
  'scripts/verifica-hardcodari.mjs',
  'scripts/verifica-hardcodari.test.mjs',
  'deploy/lib/public-target.mjs',
])
const FISIERE_GENERATE = /(?:^|\/)(?:dist|build|target|node_modules|coverage|www)(?:\/|$)/
const FISIERE_TEST = /(?:^|\/)(?:testing\/|(?:[^/]+\.)?(?:test|spec)\.[^/]+$)/

function norm(cale) {
  return cale.replaceAll('\\', '/')
}

function snapshotGit() {
  const raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: RADACINA,
    maxBuffer: 32 * 1024 * 1024,
  })
  return raw.toString('utf8').split('\0').filter(Boolean).map(norm)
}

function esteInSuprafata(cale) {
  if (EXCLUSE.has(cale) || !existsSync(resolve(RADACINA, cale)) || FISIERE_GENERATE.test(cale)) return false
  if (CONFIG_CENTRAL.has(cale)) return true
  if (cale === 'Dockerfile' || cale.startsWith('Dockerfile.')) return true
  return RADACINI.some((radacina) => cale.startsWith(radacina)) && EXTENSII.has(extname(cale).toLowerCase())
}

function linieExecutabila(linie) {
  return !/^\s*(?:\/\/|\/\*|\*|#(?!\!))/.test(linie)
}

function areExceptieValida(linie) {
  const marker = linie.indexOf('hardcod-permis:')
  if (marker < 0) return false
  const motiv = linie.slice(marker + 'hardcod-permis:'.length).trim()
  return motiv.length >= 12 && !/^(?:ok|permis|necesar|exceptie|excepție|test)$/i.test(motiv)
}

function ipv4DinText(text) {
  return [...text.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)].map((match) => match[0])
}

export function esteIPv4Public(ip) {
  const octeti = ip.split('.').map(Number)
  if (octeti.length !== 4 || octeti.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b, c] = octeti
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 88 && c === 99) return false
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false
  return true
}

function abatere(regula, potrivire) {
  return { regula, potrivire: String(potrivire).trim().slice(0, 100) }
}

/** Analizează o linie fără acces la disc; folosit și de testele porții. */
export function analizeazaLinie(cale, linie) {
  const abateri = []
  const fisierTest = FISIERE_TEST.test(cale)
  const central = CONFIG_CENTRAL.has(cale)
  if (!linieExecutabila(linie)) return abateri
  const exceptie = areExceptieValida(linie)

  if (!fisierTest && linie.includes('hardcod-permis:') && !exceptie) {
    abateri.push(abatere('R0 excepție fără motiv', 'hardcod-permis'))
  }

  if (!fisierTest && cale.startsWith('frontend/src/')) {
    const faraSubstituiriRegex = linie.replace(/\$[1-9]/g, '')
    const bani = faraSubstituiriRegex.match(/['"`][^'"`]*(?:\d+(?:[.,]\d+)?\s*(?:credite\b|credits\b)|[£$]\s*\d)[^'"`]*['"`]/iu)
    if (bani && !exceptie) abateri.push(abatere('R1 bani în interfață', bani[0]))
  }

  if (!fisierTest) {
    const model = linie.match(/['"`][^'"`\n]*\b(?:gpt-[a-z0-9][\w.-]*|chatgpt-[a-z0-9][\w.-]*|o\d(?:-[a-z0-9][\w.-]*)?)\b[^'"`\n]*['"`]/i)
    if (model) abateri.push(abatere('R2 model AI în cod', model[0]))
  }

  const email = linie.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  if (
    email && !fisierTest && !central
    && /(?:admin|owner|proprietar|administrator|ADMIN_EMAIL|OWNER_EMAIL)/i.test(linie)
    && !/(?:example|exemplu)\.(?:com|org|net)$|@local\.test$/i.test(email[0])
    && !exceptie
  ) abateri.push(abatere('R3 identitate admin în cod', email[0]))

  if (!fisierTest && !central && !exceptie) {
    for (const ip of ipv4DinText(linie)) {
      const exactLiteral = new RegExp(`['\"]${ip.replaceAll('.', '\\.')}['\"]`).test(linie)
      const contextTinta = /(?:(?:VPS|HOST|IP)(?:_|\b)|ssh|curl|https?:\/\/)/i.test(linie)
      if (esteIPv4Public(ip) && (exactLiteral || contextTinta)) abateri.push(abatere('R4 adresă IP publică în cod', ip))
    }
  }

  if (!fisierTest && !central && !exceptie) {
    const locator = linie.match(/(?:https?:\/\/)?(?:www\.)?kelionai\.app\b|kelion-team\/kelionai\b/i)
    if (locator) abateri.push(abatere('R5 locator Kelion în afara configului central', locator[0]))
  }

  if (!fisierTest && !/backend\/src\/services\/billingPolicy\.ts$/.test(cale) && !exceptie) {
    const contextComercial = /(?:credit|wallet|topup|plată|plata|payment|margin|userShare|kelionShare|revenue|split|bps)/i.test(linie)
    const impartire = linie.match(/(?:\b(?:75|25)\s*%|\b75\s*\/\s*25\b|\b(?:7_?500|2_?500)\b)/i)
    if (contextComercial && impartire) abateri.push(abatere('R6 politică 75/25 duplicată', impartire[0]))
  }

  if (!fisierTest && !exceptie) {
    const apelRemote = linie.match(/\b(?:fetch|WebSocket|EventSource|redirect)\s*\(\s*['"`](https?:\/\/[^'"`\s]+)/i)
    if (apelRemote) {
      let local = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[?::1\]?)(?::|\/|$)/i.test(apelRemote[1])
      try {
        local ||= ['127.0.0.1', 'localhost', '::1'].includes(new URL(apelRemote[1]).hostname.toLowerCase())
      } catch { /* URL-ul invalid rămâne abatere. */ }
      if (!local) abateri.push(abatere('R7 endpoint extern direct în call-site', apelRemote[0]))
    }
  }

  if (!fisierTest) {
    const secret = linie.match(/\b(?:sk-(?:proj|admin)-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[opsu]_[A-Za-z0-9]{20,})\b/)
    if (secret) abateri.push(abatere('R8 secret cu prefix cunoscut', secret[0]))
  }

  return abateri
}

export function gasesteHardcodari(fisiere = snapshotGit()) {
  const rezultat = []
  for (const cale of fisiere.filter(esteInSuprafata)) {
    const linii = readFileSync(resolve(RADACINA, cale), 'utf8').replace(/\r\n/g, '\n').split('\n')
    for (let index = 0; index < linii.length; index += 1) {
      for (const gasit of analizeazaLinie(cale, linii[index])) {
        rezultat.push({ cale, linie: index + 1, ...gasit })
      }
    }
  }
  return rezultat
}

const rulatDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (rulatDirect) {
  const abateri = gasesteHardcodari()
  if (abateri.length) {
    console.error(`Hardcodări operaționale/comerciale: ${abateri.length} abateri.`)
    for (const gasit of abateri) {
      console.error(`  ${gasit.regula} — ${gasit.cale}:${gasit.linie} → ${gasit.potrivire}`)
    }
    console.error('\nMută valoarea în configul central/server sau explică o constantă tehnică imuabilă cu un marcaj local valid.')
    process.exit(1)
  }
  console.log('Hardcodări: 0 valori operaționale/comerciale împrăștiate în cod.')
}
