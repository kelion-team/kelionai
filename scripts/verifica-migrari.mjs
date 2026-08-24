#!/usr/bin/env node
/** Poartă pentru schema PostgreSQL: DDL numai în migrări versionate. */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let ts
try { ts = require('../backend/node_modules/typescript') } catch (eroare) {
  console.error('NU POT VERIFICA migrările: TypeScript nu este instalat.')
  console.error(String(eroare))
  process.exit(2)
}

const RADACINA = fileURLToPath(new URL('..', import.meta.url))
const DDL = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|TYPE|VIEW|SCHEMA|SEQUENCE|FUNCTION|TRIGGER|EXTENSION)\b/i
const NUME_MIGRARE = /^\d{8}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/

function norm(cale) { return cale.replaceAll('\\', '/') }
function esteTest(cale) {
  return /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[^/]+$/.test(cale) || /(?:^|\/)testing(?:\/|$)/.test(cale)
}
function fisiere(dir, extensii) {
  if (!existsSync(dir)) return []
  const rezultat = []
  for (const intrare of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage'].includes(intrare.name)) continue
    const cale = join(dir, intrare.name)
    if (intrare.isDirectory()) rezultat.push(...fisiere(cale, extensii))
    else if (extensii.has(extname(intrare.name).toLowerCase())) rezultat.push(cale)
  }
  return rezultat
}

export function ddlDinSursa(cod, fisier = 'modul.ts') {
  const sursa = ts.createSourceFile(fisier, cod, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const rezultate = []
  function viziteaza(nod) {
    let text = null
    if (ts.isStringLiteralLike(nod)) text = nod.text
    else if (ts.isNoSubstitutionTemplateLiteral(nod)) text = nod.text
    else if (ts.isTemplateExpression(nod)) {
      text = nod.head.text + nod.templateSpans.map((segment) => ` ? ${segment.literal.text}`).join('')
    }
    if (text && DDL.test(text)) {
      rezultate.push({
        linie: sursa.getLineAndCharacterOfPosition(nod.getStart(sursa)).line + 1,
        fragment: text.match(DDL)?.[0].replace(/\s+/g, ' ') ?? 'DDL',
      })
    }
    ts.forEachChild(nod, viziteaza)
  }
  viziteaza(sursa)
  return rezultate
}

export function analizeazaMigrari(fisiereSql) {
  const numeInvalide = []
  const faraTranzactie = []
  const tabeleCreate = new Map()
  const distructive = []
  let areRegistru = false

  for (const fisier of fisiereSql) {
    if (!NUME_MIGRARE.test(fisier.nume)) numeInvalide.push(fisier.nume)
    const begin = (fisier.sql.match(/^\s*BEGIN\s*;/gim) ?? []).length
    const commit = (fisier.sql.match(/^\s*COMMIT\s*;/gim) ?? []).length
    if (begin !== 1 || commit !== 1 || fisier.sql.search(/\bBEGIN\s*;/i) > fisier.sql.search(/\bCOMMIT\s*;/i)) {
      faraTranzactie.push(fisier.nume)
    }
    if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?schema_migrations\b/i.test(fisier.sql)) {
      areRegistru = true
    }
    for (const gasit of fisier.sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      const lista = tabeleCreate.get(gasit[1].toLowerCase()) ?? []
      lista.push(fisier.nume)
      tabeleCreate.set(gasit[1].toLowerCase(), lista)
    }
    for (const gasit of fisier.sql.matchAll(/\b(?:DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE\s+TABLE)\b[^;]*/gi)) {
      distructive.push({ fisier: fisier.nume, sql: gasit[0].replace(/\s+/g, ' ').slice(0, 180) })
    }
  }
  const creatiiDuplicate = [...tabeleCreate.entries()].filter(([, lista]) => lista.length > 1)
  return { numeInvalide, faraTranzactie, areRegistru, creatiiDuplicate, distructive }
}

function ruleaza() {
  const surse = fisiere(resolve(RADACINA, 'backend/src'), new Set(['.ts', '.tsx']))
    .filter((cale) => !esteTest(norm(relative(RADACINA, cale))))
  const ddlRuntime = []
  for (const cale of surse) {
    const fisier = norm(relative(RADACINA, cale))
    for (const gasit of ddlDinSursa(readFileSync(cale, 'utf8'), fisier)) ddlRuntime.push({ fisier, ...gasit })
  }

  const directorMigrari = resolve(RADACINA, 'backend/migrations')
  const migrari = existsSync(directorMigrari)
    ? readdirSync(directorMigrari).filter((nume) => nume.endsWith('.sql')).sort().map((nume) => ({
        nume,
        sql: readFileSync(join(directorMigrari, nume), 'utf8'),
      }))
    : []
  const analiza = analizeazaMigrari(migrari)
  const totCodul = surse.map((cale) => readFileSync(cale, 'utf8')).join('\n')
  const areRunner = /schema_migrations/.test(totCodul) && /sha256|createHash\s*\(\s*['"]sha256/i.test(totCodul)

  console.log(`Migrări: ${migrari.length} fișiere SQL; DDL runtime: ${ddlRuntime.length}.`)
  if (ddlRuntime.length) {
    console.error(`\nDDL ÎN CODUL RUNTIME (${ddlRuntime.length}):`)
    for (const x of ddlRuntime) console.error(`  ${x.fisier}:${x.linie} — ${x.fragment}`)
  }
  if (analiza.numeInvalide.length) console.error(`\nNUME MIGRĂRI INVALIDE: ${analiza.numeInvalide.join(', ')}`)
  if (analiza.faraTranzactie.length) console.error(`\nMIGRĂRI FĂRĂ EXACT UN BEGIN/COMMIT: ${analiza.faraTranzactie.join(', ')}`)
  if (analiza.creatiiDuplicate.length) {
    console.error('\nTABELE CREATE ÎN MAI MULTE MIGRĂRI:')
    for (const [tabel, lista] of analiza.creatiiDuplicate) console.error(`  ${tabel}: ${lista.join(', ')}`)
  }
  if (!analiza.areRegistru) console.error('\nLIPSEȘTE tabela versionată schema_migrations.')
  if (!areRunner) console.error('\nLIPSEȘTE runnerul cu ordine, registru și checksum SHA-256.')
  if (analiza.distructive.length) {
    console.log(`\nInformativ: ${analiza.distructive.length} operații distructive versionate cer backup/review înainte de aplicare.`)
  }

  if (
    !migrari.length || ddlRuntime.length || analiza.numeInvalide.length || analiza.faraTranzactie.length
    || analiza.creatiiDuplicate.length || !analiza.areRegistru || !areRunner
  ) {
    console.error('\nȚinta este 0 DDL runtime și o singură istorie versionată, ordonată, cu checksum.')
    process.exit(1)
  }
  console.log('Migrări: verde (schema este schimbată exclusiv versionat).')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) ruleaza()
