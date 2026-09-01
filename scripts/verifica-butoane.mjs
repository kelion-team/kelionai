#!/usr/bin/env node
/**
 * Poartă de contract client ↔ HTTP.
 *
 * Folosește AST-ul TypeScript, nu o expresie regulată care poate lega un
 * `.get()` oarecare de o adresă aflată mii de caractere mai jos. Verifică:
 *   - fiecare adresă folosită de un client are o rută;
 *   - fiecare rută are un consumator în alt fișier sau un test de contract;
 *   - aceeași metodă + adresă nu este înregistrată de două ori.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
let ts
try {
  ts = require('../backend/node_modules/typescript')
} catch (eroare) {
  console.error('NU POT VERIFICA rutele: TypeScript nu este instalat în backend/node_modules.')
  console.error(String(eroare))
  process.exit(2)
}

const RADACINA = fileURLToPath(new URL('..', import.meta.url))
const PRODUCT = JSON.parse(readFileSync(resolve(RADACINA, 'config/product.json'), 'utf8'))
const PUBLIC_HOST = new URL(PRODUCT.publicAppOrigin).hostname.toLowerCase()
const FIRST_PARTY_HOSTS = new Set([PUBLIC_HOST, `www.${PUBLIC_HOST}`, 'localhost', '127.0.0.1'])
const METODE = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'])
const EXT_AST = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const EXT_TEXT = new Set(['.sh', '.ps1', '.py', '.java', '.swift', '.rs'])
const EXTERNAL_URL_BASE_EXPRESSIONS = new Set([
  'config.revolutMerchant.apiBaseUrl',
])

function caleRelativa(cale) {
  return relative(RADACINA, cale).replaceAll('\\', '/')
}

export function normalizeazaAdresa(adresaInitiala) {
  let adresa = String(adresaInitiala).trim()
  if (/^https?:\/\//i.test(adresa)) {
    try {
      const url = new URL(adresa)
      const gazda = url.hostname.toLowerCase()
      if (!FIRST_PARTY_HOSTS.has(gazda)) {
        return ''
      }
      adresa = url.pathname
    } catch { return '' }
  }
  if (/\s/.test(adresa)) return ''
  adresa = adresa.split(/[?#]/, 1)[0]
  adresa = adresa.replace(/\/\$\{[^}]*\}/g, '/:p').replace(/\$\{[^}]*\}/g, '')
  adresa = adresa.replace(/\/\{[^}]+\}/g, '/:p')
  adresa = adresa.replace(/[),.;}]+$/, '')
  adresa = adresa.replace(/\/+$/, '')
  return adresa || '/'
}

function textLiteral(nod) {
  if (ts.isStringLiteralLike(nod)) return nod.text
  if (!ts.isTemplateExpression(nod)) return null
  let text = nod.head.text
  for (const segment of nod.templateSpans) text += '${valoare}' + segment.literal.text
  return text
}

function metodaApelului(nod) {
  const expresie = nod.expression
  if (ts.isPropertyAccessExpression(expresie)) return expresie.name.text.toLowerCase()
  if (ts.isElementAccessExpression(expresie) && expresie.argumentExpression) {
    return textLiteral(expresie.argumentExpression)?.toLowerCase() ?? ''
  }
  return ''
}

function receptorApelului(nod) {
  const expresie = nod.expression
  if (ts.isPropertyAccessExpression(expresie) && ts.isIdentifier(expresie.expression)) {
    return expresie.expression.text
  }
  if (ts.isElementAccessExpression(expresie) && ts.isIdentifier(expresie.expression)) {
    return expresie.expression.text
  }
  return ''
}

function esteAfirmatieNegativa(nod, sursa) {
  let curent = nod.parent
  for (let nivel = 0; curent && nivel < 8; nivel += 1, curent = curent.parent) {
    if (ts.isCallExpression(curent) && /(?:^|\.)not\./.test(curent.expression.getText(sursa))) return true
  }
  return false
}

function linie(sursa, pozitie) {
  return sursa.getLineAndCharacterOfPosition(pozitie).line + 1
}

export function analizeazaSursa(cod, numeFisier = 'fisier.ts') {
  const fel = /\.tsx?$/.test(numeFisier) ? ts.ScriptKind.TSX : ts.ScriptKind.JS
  const sursa = ts.createSourceFile(numeFisier, cod, ts.ScriptTarget.Latest, true, fel)
  const declaratii = []
  const literaliDeclaratie = new Set()
  const referinte = []
  const receptoriFastify = new Set(['app', 'fastify'])
  const constructoriUrlExtern = new Set()

  function detecteazaConstructoriUrlExtern(nod) {
    if (ts.isFunctionDeclaration(nod) && nod.name && nod.body && nod.parameters.length === 1) {
      let bazaExterna = false
      function cautaBaza(curent) {
        if (
          ts.isNewExpression(curent)
          && curent.expression.getText(sursa) === 'URL'
          && curent.arguments?.[0]
          && EXTERNAL_URL_BASE_EXPRESSIONS.has(curent.arguments[0].getText(sursa))
        ) bazaExterna = true
        ts.forEachChild(curent, cautaBaza)
      }
      cautaBaza(nod.body)
      if (bazaExterna) constructoriUrlExtern.add(nod.name.text)
    }
    ts.forEachChild(nod, detecteazaConstructoriUrlExtern)
  }
  detecteazaConstructoriUrlExtern(sursa)

  function esteArgumentConstructorExtern(nod) {
    const parinte = nod.parent
    if (!ts.isCallExpression(parinte) || !parinte.arguments.includes(nod)) return false
    return ts.isIdentifier(parinte.expression) && constructoriUrlExtern.has(parinte.expression.text)
  }

  function adaugaDeclaratie(metoda, argument, nod) {
    const brut = textLiteral(argument)
    if (!brut || !brut.startsWith('/')) return
    const adresa = normalizeazaAdresa(brut)
    declaratii.push({ metoda: metoda.toUpperCase(), adresa, linie: linie(sursa, nod.getStart(sursa)) })
    literaliDeclaratie.add(argument)
  }

  function viziteaza(nod) {
    if (ts.isCallExpression(nod)) {
      const metoda = metodaApelului(nod)
      const receptor = receptorApelului(nod)
      if (receptoriFastify.has(receptor) && metoda === 'register' && nod.arguments[0]) {
        const plugin = nod.arguments[0]
        if ((ts.isArrowFunction(plugin) || ts.isFunctionExpression(plugin)) && plugin.parameters[0]) {
          const parametru = plugin.parameters[0].name
          if (ts.isIdentifier(parametru)) receptoriFastify.add(parametru.text)
        }
      }
      if (receptoriFastify.has(receptor) && METODE.has(metoda) && nod.arguments[0]) {
        adaugaDeclaratie(metoda, nod.arguments[0], nod)
      }

      if (receptoriFastify.has(receptor) && metoda === 'route' && nod.arguments[0] && ts.isObjectLiteralExpression(nod.arguments[0])) {
        let metodaRuta = ''
        let urlRuta = null
        for (const proprietate of nod.arguments[0].properties) {
          if (!ts.isPropertyAssignment(proprietate)) continue
          const nume = proprietate.name.getText(sursa).replace(/^['"]|['"]$/g, '')
          if (nume === 'method') metodaRuta = textLiteral(proprietate.initializer)?.toLowerCase() ?? ''
          if (nume === 'url') urlRuta = proprietate.initializer
        }
        if (METODE.has(metodaRuta) && urlRuta) adaugaDeclaratie(metodaRuta, urlRuta, nod)
      }
    }
    ts.forEachChild(nod, viziteaza)
  }
  viziteaza(sursa)

  function colecteaza(nod) {
    if (
      (ts.isStringLiteralLike(nod) || ts.isTemplateExpression(nod))
      && !literaliDeclaratie.has(nod)
      && !esteAfirmatieNegativa(nod, sursa)
      && !esteArgumentConstructorExtern(nod)
    ) {
      const brut = textLiteral(nod)
      if (brut && (brut.startsWith('/') || /^https?:\/\//i.test(brut))) {
        const adresa = normalizeazaAdresa(brut)
        if (adresa.startsWith('/') && adresa !== '/') {
          referinte.push({ adresa, linie: linie(sursa, nod.getStart(sursa)) })
        }
      }
    }
    ts.forEachChild(nod, colecteaza)
  }
  colecteaza(sursa)
  return { declaratii, referinte }
}

function fisiereGit() {
  const rezultat = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: RADACINA,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (rezultat.status !== 0) throw new Error(rezultat.stderr || rezultat.stdout || 'git ls-files a eșuat')
  return rezultat.stdout.split('\0').filter(Boolean).map((cale) => resolve(RADACINA, cale)).filter(existsSync)
}

function potrivesc(apel, ruta) {
  const a = apel.split('/')
  const r = ruta.split('/')
  return a.length === r.length && a.every((segment, index) => (
    segment === r[index] || segment === ':p' || r[index].startsWith(':') || r[index] === '*'
  ))
}

function primulSegment(adresa) {
  return adresa.split('/').filter(Boolean)[0] ?? ''
}

export function verificaContracte(intrari) {
  const rute = []
  const referinte = []
  for (const intrare of intrari) {
    for (const ruta of intrare.declaratii) rute.push({ ...ruta, fisier: intrare.fisier })
    for (const referinta of intrare.referinte) referinte.push({ ...referinta, fisier: intrare.fisier })
  }

  const segmenteServer = new Set(rute.map((ruta) => primulSegment(ruta.adresa)))
  const adreseServer = new Set(rute.map((ruta) => ruta.adresa))
  const apeluri = referinte.filter((referinta) => {
    if (!segmenteServer.has(primulSegment(referinta.adresa))) return false
    const segmente = referinta.adresa.split('/').filter(Boolean)
    return segmente.length > 1 || adreseServer.has(referinta.adresa)
  })
  const esteTest = (fisier) => /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[^/]+$/.test(fisier)
  const estePrefixDePolitica = (adresa) => (
    adresa.includes('*') || rute.some((ruta) => ruta.adresa.startsWith(`${adresa}/`))
  )
  const apeluriFaraRuta = apeluri.filter((apel) => (
    !esteTest(apel.fisier)
    && !estePrefixDePolitica(apel.adresa)
    && !rute.some((ruta) => potrivesc(apel.adresa, ruta.adresa))
  ))

  const ruteFaraConsumator = rute.filter((ruta) => !apeluri.some((apel) => (
    apel.fisier !== ruta.fisier && potrivesc(apel.adresa, ruta.adresa)
  )))

  const grupuri = new Map()
  for (const ruta of rute) {
    const cheie = `${ruta.metoda} ${ruta.adresa}`
    const grup = grupuri.get(cheie) ?? []
    grup.push(ruta)
    grupuri.set(cheie, grup)
  }
  const ruteDuplicate = [...grupuri.entries()].filter(([, grup]) => grup.length > 1)
  return { rute, apeluri, apeluriFaraRuta, ruteFaraConsumator, ruteDuplicate }
}

function ruleaza() {
  let cai
  try { cai = fisiereGit() } catch (eroare) {
    console.error(`NU POT VERIFICA rutele: ${String(eroare)}`)
    process.exit(2)
  }

  const intrari = []
  for (const cale of cai) {
    const extensie = extname(cale).toLowerCase()
    if (!EXT_AST.has(extensie) && !EXT_TEXT.has(extensie)) continue
    const fisier = caleRelativa(cale)
    if (fisier === 'scripts/verifica-butoane.test.mjs') continue
    if (/(^|\/)(?:node_modules|dist|build|coverage|target)(?:\/|$)/.test(fisier)) continue
    const cod = readFileSync(cale, 'utf8')
    if (EXT_AST.has(extensie)) {
      intrari.push({ fisier, ...analizeazaSursa(cod, fisier) })
      continue
    }
    const referinte = []
    for (const gasit of cod.matchAll(/(?:https?:\/\/[^\s'"`]+)?(\/(?:api|auth|dl|health|livez|readyz)(?:\/[^\s'"`]*)?)/g)) {
      referinte.push({ adresa: normalizeazaAdresa(gasit[1]), linie: cod.slice(0, gasit.index).split('\n').length })
    }
    intrari.push({ fisier, declaratii: [], referinte })
  }

  const rezultat = verificaContracte(intrari)
  console.log(`Contract HTTP: ${rezultat.rute.length} rute, ${rezultat.apeluri.length} referințe client/test.`)

  if (rezultat.apeluriFaraRuta.length) {
    console.error(`\nAPELURI FĂRĂ RUTĂ (${rezultat.apeluriFaraRuta.length}):`)
    for (const apel of rezultat.apeluriFaraRuta) console.error(`  ${apel.adresa} — ${apel.fisier}:${apel.linie}`)
  }
  if (rezultat.ruteFaraConsumator.length) {
    console.error(`\nRUTE FĂRĂ CONSUMATOR SAU TEST ÎN ALT FIȘIER (${rezultat.ruteFaraConsumator.length}):`)
    for (const ruta of rezultat.ruteFaraConsumator) {
      console.error(`  ${ruta.metoda} ${ruta.adresa} — ${ruta.fisier}:${ruta.linie}`)
    }
  }
  if (rezultat.ruteDuplicate.length) {
    console.error(`\nRUTE DUBLATE (${rezultat.ruteDuplicate.length}):`)
    for (const [cheie, grup] of rezultat.ruteDuplicate) {
      console.error(`  ${cheie} — ${grup.map((ruta) => `${ruta.fisier}:${ruta.linie}`).join(', ')}`)
    }
  }

  if (rezultat.rute.length === 0 || rezultat.apeluri.length === 0) {
    console.error('\nNU POT VERIFICA: inventarul HTTP este gol sau incomplet.')
    process.exit(2)
  }
  if (rezultat.apeluriFaraRuta.length || rezultat.ruteFaraConsumator.length || rezultat.ruteDuplicate.length) {
    console.error('\nȚinta este 0: fiecare rută are contract, consumator/test și o singură înregistrare.')
    process.exit(1)
  }
  console.log('Contract HTTP: verde (0 apeluri rupte, 0 rute orfane, 0 duplicate).')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) ruleaza()
