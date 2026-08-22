#!/usr/bin/env node
// ── IDENTIFICĂ TESTELE MORTE ────────────────────────────────────────────────
// Caută fișiere *.test.ts / *.test.tsx și verifică dacă importă fișiere care
// nu mai există. Un test care importă un modul șters = mort (o să pice la run).
//
// Rulare: node scripts/identifica-teste-moarte.mjs
// Opțional: node scripts/identifica-teste-moarte.mjs --sterge   (îl șterge efectiv)
//
// NU șterge nimic implicit — doar raportează. Folosește --sterge doar după
// ce verifici manual lista.

import { readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RADACINA = resolve(fileURLToPath(import.meta.url), '..', '..')
const STERGE = process.argv.includes('--sterge')

function* fisiere(dir, ext) {
  for (const nume of readdirSync(dir)) {
    const cale = join(dir, nume)
    const st = statSync(cale)
    if (st.isDirectory()) {
      if (nume === 'node_modules' || nume === 'dist' || nume === '.git') continue
      yield* fisiere(cale, ext)
    } else if (ext.some((e) => nume.endsWith(e))) {
      yield cale
    }
  }
}

function exista(cale) {
  try {
    return statSync(cale).isFile()
  } catch {
    return false
  }
}

const importRe = /(?:^|;|\s)import\s+(?:{[^}]*}|[^\s'"]*)\s*from\s*['"]([^'"]+)['"]|(?:^|\s)require\(['"]([^'"]+)['"]\)/g
const importReDinamic = /import\(['"]([^'"]+)['"]\)/g

const morti = []
const total = []

for (const test of [
  ...fisiere(join(RADACINA, 'backend', 'src'), ['.test.ts']),
  ...fisiere(join(RADACINA, 'frontend', 'src'), ['.test.ts', '.test.tsx']),
]) {
  total.push(test)
  const text = readFileSync(test, 'utf8')
  const caleDir = dirname(test)
  const lipsa = []

  for (const re of [importRe, importReDinamic]) {
    let m
    while ((m = re.exec(text)) !== null) {
      const spec = m[1] || m[2]
      if (!spec || !spec.startsWith('.') || isAbsolute(spec)) continue
      // Resolves TS/JS: the project compiles TS to .js, but source may be .ts.
      const base = resolve(caleDir, spec)
      const posibile = [
        base,
        base + '.ts',
        base + '.tsx',
        base + '.js',
        base + '.mjs',
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
        join(base, 'index.js'),
      ]
      if (!posibile.some(exista)) {
        lipsa.push(spec)
      }
    }
  }

  if (lipsa.length) {
    morti.push({ test: test.replace(RADACINA + '\\', '').replace(RADACINA + '/', ''), lipsa })
  }
}

console.log(`Total teste: ${total.length}`)
if (!morti.length) {
  console.log('Niciun test mort găsit (toate importurile relative există).')
  process.exit(0)
}

console.log(`Teste moarte găsite: ${morti.length}`)
for (const { test, lipsa } of morti) {
  console.log(`\n  ${test}`)
  for (const l of lipsa) console.log(`    → import lipsă: ${l}`)
}

if (STERGE) {
  for (const { test } of morti) {
    const cale = join(RADACINA, test)
    unlinkSync(cale)
    console.log(`  Șters: ${test}`)
  }
  console.log(`\nȘterse ${morti.length} fișiere.`)
} else {
  console.log('\nRerun with --sterge pentru a șterge, DUPĂ verificare manuală.')
}
