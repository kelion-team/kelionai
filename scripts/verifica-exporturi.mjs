#!/usr/bin/env node
/**
 * Poartă de cod mort bazată pe graful real de module TypeScript.
 *
 * Un nume apărut într-un comentariu sau într-un test nu justifică un export de
 * producție. Pornim din entrypointurile livrate și urmărim importurile statice,
 * dinamice și worker-ele încărcate prin `new URL(..., import.meta.url)`.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let ts
try {
  ts = require('../backend/node_modules/typescript')
} catch (eroare) {
  console.error('NU POT VERIFICA exporturile: TypeScript nu este instalat în backend/node_modules.')
  console.error(String(eroare))
  process.exit(2)
}

const RADACINA = fileURLToPath(new URL('..', import.meta.url))
const RADACINI = ['backend/src', 'frontend/src']
const EXTENSII = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
// Entry points delivered independently by package scripts are roots too; the
// migrator never belongs to the long-running web process.
// The root-only VPS reporter is also shipped in backend/dist by the image build;
// its header documents the operator command. It is not a web/AI-tool route.
const INTRARI = ['backend/src/index.ts', 'backend/src/migrate.ts', 'backend/src/constructorRemediationReporter.ts', 'frontend/src/main.tsx']

function norm(cale) {
  return cale.replaceAll('\\', '/')
}

function esteTest(cale) {
  return /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[^/]+$/.test(cale) || /(?:^|\/)testing(?:\/|$)/.test(cale)
}

function fisiere(dir) {
  const rezultat = []
  for (const intrare of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage'].includes(intrare.name)) continue
    const cale = join(dir, intrare.name)
    if (intrare.isDirectory()) rezultat.push(...fisiere(cale))
    else if (EXTENSII.includes(extname(intrare.name).toLowerCase()) && !intrare.name.endsWith('.d.ts')) rezultat.push(cale)
  }
  return rezultat
}

function areModificator(nod, fel) {
  return nod.modifiers?.some((modificator) => modificator.kind === fel) ?? false
}

function numeDeclarate(nume, rezultat) {
  if (ts.isIdentifier(nume)) rezultat.push(nume.text)
  else if (ts.isObjectBindingPattern(nume) || ts.isArrayBindingPattern(nume)) {
    for (const element of nume.elements) {
      if (ts.isBindingElement(element)) numeDeclarate(element.name, rezultat)
    }
  }
}

function textModul(nod) {
  return nod && ts.isStringLiteralLike(nod) ? nod.text : null
}

export function analizeazaModul(cod, fisier = 'modul.ts') {
  const fel = /\.tsx?$/.test(fisier) ? ts.ScriptKind.TSX : ts.ScriptKind.JS
  const sursa = ts.createSourceFile(fisier, cod, ts.ScriptTarget.Latest, true, fel)
  const dependente = []
  const exporturi = []

  const adaugaDependenta = (specificator, nume = []) => {
    if (typeof specificator === 'string' && specificator.startsWith('.')) dependente.push({ specificator, nume })
  }
  const adaugaExport = (nume, nod) => {
    const pozitie = sursa.getLineAndCharacterOfPosition(nod.getStart(sursa))
    exporturi.push({ nume, linie: pozitie.line + 1 })
  }

  for (const declaratie of sursa.statements) {
    if (ts.isImportDeclaration(declaratie)) {
      const specificator = textModul(declaratie.moduleSpecifier)
      const nume = []
      const clauza = declaratie.importClause
      if (clauza?.name) nume.push('default')
      if (clauza?.namedBindings) {
        if (ts.isNamespaceImport(clauza.namedBindings)) nume.push('*')
        else for (const element of clauza.namedBindings.elements) nume.push(element.propertyName?.text ?? element.name.text)
      }
      adaugaDependenta(specificator, nume)
      continue
    }

    if (ts.isExportDeclaration(declaratie)) {
      const specificator = textModul(declaratie.moduleSpecifier)
      const numeTinta = []
      if (declaratie.exportClause && ts.isNamedExports(declaratie.exportClause)) {
        for (const element of declaratie.exportClause.elements) {
          adaugaExport(element.name.text, element)
          numeTinta.push(element.propertyName?.text ?? element.name.text)
        }
      } else if (specificator) {
        numeTinta.push('*')
      }
      adaugaDependenta(specificator, numeTinta)
      continue
    }

    if (!areModificator(declaratie, ts.SyntaxKind.ExportKeyword)) continue
    if (areModificator(declaratie, ts.SyntaxKind.DefaultKeyword)) {
      adaugaExport('default', declaratie)
      continue
    }
    if (
      ts.isFunctionDeclaration(declaratie) || ts.isClassDeclaration(declaratie)
      || ts.isInterfaceDeclaration(declaratie) || ts.isTypeAliasDeclaration(declaratie)
      || ts.isEnumDeclaration(declaratie)
    ) {
      if (declaratie.name) adaugaExport(declaratie.name.text, declaratie)
      continue
    }
    if (ts.isVariableStatement(declaratie)) {
      for (const element of declaratie.declarationList.declarations) {
        const nume = []
        numeDeclarate(element.name, nume)
        for (const valoare of nume) adaugaExport(valoare, element)
      }
    }
  }

  function viziteaza(nod) {
    if (
      ts.isCallExpression(nod) && nod.expression.kind === ts.SyntaxKind.ImportKeyword
      && nod.arguments[0] && ts.isStringLiteralLike(nod.arguments[0])
    ) adaugaDependenta(nod.arguments[0].text, ['*'])

    if (
      ts.isNewExpression(nod) && ts.isIdentifier(nod.expression) && nod.expression.text === 'URL'
      && nod.arguments?.[0] && ts.isStringLiteralLike(nod.arguments[0])
    ) adaugaDependenta(nod.arguments[0].text, ['*'])
    ts.forEachChild(nod, viziteaza)
  }
  viziteaza(sursa)
  const aparitiiIdentificatori = new Map()
  function numaraIdentificatori(nod) {
    if (ts.isIdentifier(nod)) aparitiiIdentificatori.set(nod.text, (aparitiiIdentificatori.get(nod.text) ?? 0) + 1)
    ts.forEachChild(nod, numaraIdentificatori)
  }
  numaraIdentificatori(sursa)
  return {
    dependente,
    exporturi: exporturi.map((exportat) => ({
      ...exportat,
      folositLocal: exportat.nume !== 'default' && (aparitiiIdentificatori.get(exportat.nume) ?? 0) > 1,
    })),
  }
}

function rezolvaModul(dinFisier, specificator, fisiereCunoscute) {
  const baza = resolve(dirname(dinFisier), specificator)
  const extensie = extname(baza)
  const candidati = []
  if (extensie) {
    candidati.push(baza)
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(extensie)) {
      const fara = baza.slice(0, -extensie.length)
      candidati.push(`${fara}.ts`, `${fara}.tsx`)
    }
  } else {
    for (const ext of EXTENSII) candidati.push(`${baza}${ext}`)
    for (const ext of EXTENSII) candidati.push(join(baza, `index${ext}`))
  }
  return candidati.find((candidat) => fisiereCunoscute.has(resolve(candidat))) ?? null
}

export function calculeazaCodMort(moduleVirtuale, intrari) {
  const module = new Map(moduleVirtuale.map((modul) => [modul.fisier, modul]))
  const muchii = new Map()
  for (const modul of module.values()) {
    const lista = []
    for (const dependenta of modul.dependenteRezolvate ?? []) lista.push(dependenta)
    muchii.set(modul.fisier, lista)
  }

  const accesibile = new Set()
  const coada = [...intrari].filter((intrare) => module.has(intrare))
  while (coada.length) {
    const curent = coada.pop()
    if (accesibile.has(curent)) continue
    accesibile.add(curent)
    for (const dependenta of muchii.get(curent) ?? []) coada.push(dependenta.fisier)
  }

  const folosite = new Map()
  for (const fisier of accesibile) {
    for (const dependenta of muchii.get(fisier) ?? []) {
      if (!accesibile.has(dependenta.fisier)) continue
      const set = folosite.get(dependenta.fisier) ?? new Set()
      for (const nume of dependenta.nume) set.add(nume)
      folosite.set(dependenta.fisier, set)
    }
  }

  const setIntrari = new Set(intrari)
  const fisiereInaccesibile = [...module.keys()].filter((fisier) => !accesibile.has(fisier)).sort()
  const exporturiNefolosite = []
  for (const fisier of accesibile) {
    if (setIntrari.has(fisier)) continue
    const utilizari = folosite.get(fisier) ?? new Set()
    if (utilizari.has('*')) continue
    for (const exportat of module.get(fisier).exporturi) {
      if (!utilizari.has(exportat.nume) && !exportat.folositLocal) exporturiNefolosite.push({ fisier, ...exportat })
    }
  }
  return { accesibile, fisiereInaccesibile, exporturiNefolosite }
}

function ruleaza() {
  const cai = RADACINI.flatMap((radacina) => {
    const absoluta = resolve(RADACINA, radacina)
    return existsSync(absoluta) ? fisiere(absoluta) : []
  })
  const productie = cai.filter((cale) => !esteTest(norm(relative(RADACINA, cale))))
  if (!productie.length) {
    console.error('NU POT VERIFICA exporturile: nu există module de producție.')
    process.exit(2)
  }

  const cunoscute = new Set(productie.map((cale) => resolve(cale)))
  const module = productie.map((cale) => {
    const fisier = norm(relative(RADACINA, cale))
    const analizat = analizeazaModul(readFileSync(cale, 'utf8'), fisier)
    const dependenteRezolvate = analizat.dependente.map((dependenta) => {
      const tinta = rezolvaModul(cale, dependenta.specificator, cunoscute)
      return tinta ? { fisier: norm(relative(RADACINA, tinta)), nume: dependenta.nume } : null
    }).filter(Boolean)
    return { fisier, exporturi: analizat.exporturi, dependenteRezolvate }
  })

  const rezultat = calculeazaCodMort(module, INTRARI)
  console.log(`Graf module: ${module.length} producție, ${rezultat.accesibile.size} accesibile din entrypointuri.`)
  if (rezultat.fisiereInaccesibile.length) {
    console.error(`\nFIȘIERE DE PRODUCȚIE INACCESIBILE (${rezultat.fisiereInaccesibile.length}):`)
    for (const fisier of rezultat.fisiereInaccesibile) console.error(`  ${fisier}`)
  }
  if (rezultat.exporturiNefolosite.length) {
    console.error(`\nEXPORTURI PUBLICE NECONSUMATE (${rezultat.exporturiNefolosite.length}):`)
    for (const exportat of rezultat.exporturiNefolosite) {
      console.error(`  ${exportat.fisier}:${exportat.linie} — ${exportat.nume}`)
    }
  }
  if (rezultat.fisiereInaccesibile.length || rezultat.exporturiNefolosite.length) {
    console.error('\nȚinta este 0: șterge modulele moarte și elimină exporturile fără consumator de producție.')
    process.exit(1)
  }
  console.log('Cod mort: 0 module inaccesibile și 0 exporturi publice neconsumate.')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) ruleaza()
