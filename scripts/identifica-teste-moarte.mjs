#!/usr/bin/env node
// ── IDENTIFICĂ TESTELE MORTE ────────────────────────────────────────────────
// Caută fișiere *.test.ts / *.test.tsx și verifică dacă importă fișiere care
// nu mai există. Un test care importă un modul șters = mort (o să pice la run).
//
// Rulare: node scripts/identifica-teste-moarte.mjs
// Poarta este intenționat doar-citire. Ștergerea automată pe baza unei analize
// statice euristice poate elimina teste valide; remedierea se face numai după
// verificarea manuală a fiecărui import raportat.

import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fisiereCod } from './lib/fisiere-cod.mjs'

const RADACINA = resolve(fileURLToPath(import.meta.url), '..', '..')
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
  ...fisiereCod(join(RADACINA, 'backend', 'src'), ['.test.ts']),
  ...fisiereCod(join(RADACINA, 'frontend', 'src'), ['.test.ts', '.test.tsx']),
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
      const extensie = extname(base)
      const bazaSursa = ['.js', '.mjs', '.cjs'].includes(extensie) ? base.slice(0, -extensie.length) : base
      const posibile = [...new Set([
        base,
        bazaSursa + '.ts',
        bazaSursa + '.tsx',
        bazaSursa + '.js',
        bazaSursa + '.mjs',
        join(bazaSursa, 'index.ts'),
        join(bazaSursa, 'index.tsx'),
        join(bazaSursa, 'index.js'),
      ])]
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

console.log('\nPoarta nu șterge automat; verifică manual fiecare raport înainte de remediere.')
process.exit(1)
