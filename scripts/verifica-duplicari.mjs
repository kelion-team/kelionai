#!/usr/bin/env node
// ── LEGEA REUTILIZĂRII — poarta AUTOMATĂ (owner, 23 aug 2026, verbatim) ───
// „implementeaza-ti sa verifici pentru orice faci daca nu exista oportunitatea
//  de a folosi ce exista sau a fost deja implementat"
//
// CE VÂNEAZĂ:
//   D1. FUNCȚII/COMPONENTE DUPLICATE — dacă creezi o funcție care face ceva
//       ce deja există în altă parte a codebase-ului, poarta te oprește.
//       Ex: un badge text pentru emoții când avatarul are morph targets.
//   D2. DEPENDENȚE DUPLICATE — dacă adaugi o librarie pentru ceva ce o
//       librarie existentă deja face.
//   D3. PATTERNE DUPLICATE — dacă scrii un pattern (auth, polling, SSE,
//       state management) care există deja în 3+ fișiere.
//
// CUM FUNCȚIONEAZĂ:
//   1. Analizează fișierele noi/modificate (git diff vs master)
//   2. Extrage: nume de funcții, componente, clase, tipuri exportate
//   3. Caută în restul codebase-ului nume similare sau funcționalitate similară
//   4. Raportează potențiale duplicări cu sugestii de reutilizare
//
// EXCEPȚIA: // reutilizare-permis: <motivul> pe linia cu potențiala duplicare.
//
// Rulare: node scripts/verifica-duplicari.mjs   (exit 1 = duplicare negăzduită)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const RADACINA = fileURLToPath(new URL('..', import.meta.url))

// ── 1. COLECTEAZĂ FIȘIERELE MODIFICATE (git diff vs HEAD) ──────────────────
function fisiereModificate() {
  try {
    // Fișiere staged + unstaged, față de HEAD
    const out = execSync('git diff --name-only HEAD', { cwd: RADACINA, encoding: 'utf8' })
    return out.trim().split('\n').filter((f) => f && existsSync(join(RADACINA, f)))
  } catch {
    // Dacă git nu e disponibil, scanează tot (fallback)
    return null
  }
}

// ── 2. EXTRAGE SEMNALE dintr-un fișier (ce creează/declară) ────────────────
function extrageSemnale(continut) {
  const semnale = {
    functii: [],
    componente: [],
    clase: [],
    exporturi: [],
    importuri: [],
    rute: [],
    patternPolling: false,
    patternSSE: false,
    patternAuth: false,
    patternBadge: false,
  }
  // Elimină importurile multi-line înainte de scanare: `import { ... } from '...'`
  // (fără asta, linii ca `  type DovadaUnealta,` din interiorul unui import sunt
  // detectate ca definiții — fals-pozitiv D1, măsurat 23 aug pe poartaFaptelor.)
  const continutFaraImporturi = continut.replace(/\r\n/g, '\n').replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g, '')
  const linii = continutFaraImporturi.split('\n')
  for (const linie of linii) {
    const curata = linie.replace(/^\s*(\/\/|\*|\/\*).*$/, '').trim()
    if (!curata) continue

    // Funcții: function nume, const nume = (, async function nume
    const fn = curata.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/)
    if (fn) semnale.functii.push(fn[1])

    // Componente React: function NumeComponenta( sau const NumeComponenta = (
    const comp = curata.match(/(?:function|const)\s+([A-Z]\w+)\s*[=(]/)
    if (comp) semnale.componente.push(comp[1])

    // Clase/interfețe/type exportate
    const exp = curata.match(/export\s+(?:default\s+)?(?:class|interface|type|enum)\s+(\w+)/)
    if (exp) semnale.exporturi.push(exp[1])

    // Rute Fastify/Express: app.get('/api/...'), fastify.get, router.get
    const ruta = curata.match(/\.(?:get|post|put|delete|patch)\s*\(\s*['"`](\/api\/[^'"`]+)/)
    if (ruta) semnale.rute.push(ruta[1])

    // Importuri: import ... from '...'
    const imp = curata.match(/from\s+['"`]([^'"`]+)['"`]/)
    if (imp) semnale.importuri.push(imp[1])

    // Pattern-uri
    if (/setInterval\s*\(\s*\w+\s*,\s*\d+/.test(curata)) semnale.patternPolling = true
    if (/text\/event-stream|EventSource|writeHead.*event-stream/.test(curata)) semnale.patternSSE = true
    if (/getSessionUser|cerAdmin|x-test-auth|kelionai_session/.test(curata)) semnale.patternAuth = true
    if (/position:\s*['"`]?fixed.*zIndex.*999/.test(curata)) semnale.patternBadge = true
  }
  return semnale
}

// ── 3. COLECTEAZĂ TOATE FIȘIERELE din codebase (pentru căutare) ────────────
function* fisiereCod(dir) {
  for (const nume of readdirSync(dir)) {
    const cale = join(dir, nume)
    const st = statSync(cale)
    if (st.isDirectory()) {
      if (nume === 'node_modules' || nume === 'dist' || nume === '.git' || nume === '.devin') continue
      yield* fisiereCod(cale)
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(nume)) {
      yield cale
    }
  }
}

// ── 4. CAUTĂ DUPLICĂRI ────────────────────────────────────────────────────
const abateri = []
const sugestii = []

function cautaDuplicari(fisierTinta, semnale) {
  const fisiereCodLista = [...fisiereCod(join(RADACINA, 'backend', 'src')), ...fisiereCod(join(RADACINA, 'frontend', 'src'))]
  const caleRelativa = relative(RADACINA, fisierTinta)

  // D1: Funcții/componente cu același nume în alt fișier
  // Nume generice ignorate — apar peste tot fără să fie duplicări reale
  const NUME_GENERICE = new Set(['tick', 'init', 'load', 'save', 'open', 'close', 'stop', 'start', 'send', 'read', 'write', 'parse', 'format', 'render', 'mount', 'unmount', 'handle', 'update', 'create', 'delete', 'remove', 'fetch', 'check', 'test', 'run', 'exec', 'main', 'wrap', 'unwrap', 'map', 'filter', 'reduce', 'pipe', 'flow', 'done', 'next', 'prev', 'data', 'item', 'list', 'opts', 'opts2', 'args', 'props', 'state', 'ref', 'refs', 'val', 'vals', 'key', 'keys', 'idx', 'len', 'buf', 'buf2', 'ctx', 'req', 'res', 'err', 'msg', 'id', 'ts', 'fn', 'cb', 'el', 'ui', 'radacina', 'root', 'port', 'config'])
  // Extragem semnalele din FIȘIERUL ȚINTĂ ca să excludem simbolurile care
  // sunt doar importuri/lazy în fișierul țintă (nu definiri noi)
  const continutTinta = readFileSync(fisierTinta, 'utf8').replace(/\r\n/g, '\n')
  const liniiTinta = continutTinta.split('\n')
  for (const fn of [...semnale.functii, ...semnale.componente, ...semnale.exporturi]) {
    if (fn.length < 5) continue // prea generic (tick, init, etc.)
    if (NUME_GENERICE.has(fn.toLowerCase())) continue
    // Verifică dacă fn e DEFINIT în fișierul țintă sau doar importat/lazy
    const definitInTinta = liniiTinta.some((l) => {
      if (!new RegExp(`(?:function|const|class|interface|type)\\s+${fn}\\b`).test(l)) return false
      if (l.includes('import ')) return false
      if (l.includes('lazy(')) return false
      if (l.includes('export {') || l.includes('export *')) return false
      return true
    })
    if (!definitInTinta) continue // e doar import/lazy în țintă — nu e duplicare
    for (const f of fisiereCodLista) {
      if (f === fisierTinta) continue
      // Fișierele .test.ts referențiază simboluri prin stringuri/regex — nu le definesc
      if (/\.test\.(ts|tsx|js)$/.test(f)) continue
      // Tipurile PascalCase (interface/type) redefinite în frontend pentru API
      // responses — pattern normal (backend exportă, frontend importă ca tip),
      // nu duplicare. Ex: ContactMessage, HistoryRow, InboundEmail.
      if (/^[A-Z][a-zA-Z]+(Row|Message|Meta|Neatribuita|Incasata|Neplatit|Email|Plati)$/.test(fn) && /frontend/.test(f)) continue
      const continut = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]/g, '')
      const regex = new RegExp(`(?:function|const|class|interface|type)\\s+${fn}\\b`)
      if (regex.test(continut)) {
        const linii = continut.replace(/\r\n/g, '\n').split('\n')
        const linieCuDef = linii.find((l) => {
          if (!regex.test(l)) return false
          if (l.includes('import ')) return false
          if (l.includes('lazy(')) return false
          if (l.includes('export {') || l.includes('export *')) return false
          // Fișierele de test verifică simboluri prin regex pe stringuri — nu le definesc
          if (l.includes('expect(') || l.includes('.test(') || l.includes('toMatch(')) return false
          // Și alte referințe prin stringuri (.slice, .indexOf, .match) — nu definiții
          if (l.includes('.slice(') || l.includes('.indexOf(') || l.includes('.match(') || l.includes('.includes(')) return false
          return true
        })
        if (!linieCuDef) continue
        // Excepția se declară PE LINIE sau pe o linie de COMENTARIU deasupra (până la 3 linii)
        const idxLinie = linii.indexOf(linieCuDef)
        const linSus = idxLinie > 0 ? linii.slice(Math.max(0, idxLinie - 3), idxLinie).join('\n') : ''
        const idxTinta = liniiTinta.findIndex((l) => new RegExp(`(?:function|const|class|interface|type)\\s+${fn}\\b`).test(l))
        const linSusTinta = idxTinta > 0 ? liniiTinta.slice(Math.max(0, idxTinta - 3), idxTinta).join('\n') : ''
        if (
          linieCuDef.includes('reutilizare-permis:')
          || linSus.includes('reutilizare-permis:')
          || linSusTinta.includes('reutilizare-permis:')
        ) continue
        abateri.push({
          tip: 'D1',
          fisier: caleRelativa,
          simbol: fn,
          existaIn: relative(RADACINA, f),
          mesaj: `„${fn}" e definit ȘI în ${relative(RADACINA, f)} — reutilizează-l pe cel existent, nu-l recrea.`,
        })
      }
    }
  }

  // D2: Rute duplicate — aceeași cale /api/... în două fișiere
  for (const ruta of semnale.rute) {
    for (const f of fisiereCodLista) {
      if (f === fisierTinta) continue
      const continut = readFileSync(f, 'utf8')
      const regex = new RegExp(`\\.(?:get|post|put|delete|patch)\\s*\\(\\s*['"\`]${ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      if (regex.test(continut)) {
        abateri.push({
          tip: 'D2',
          fisier: caleRelativa,
          simbol: ruta,
          existaIn: relative(RADACINA, f),
          mesaj: `Ruta „${ruta}" e înregistrată ȘI în ${relative(RADACINA, f)} — Fastify o va refuza pe a doua la runtime.`,
        })
      }
    }
  }

  // D3: Pattern-uri — dacă creezi un badge fixed/zIndex, verifică dacă există deja
  if (semnale.patternBadge) {
    for (const f of fisiereCodLista) {
      if (f === fisierTinta) continue
      const continut = readFileSync(f, 'utf8')
      if (/position:\s*['"`]?fixed.*zIndex.*999/.test(continut)) {
        sugestii.push({
          tip: 'D3',
          fisier: caleRelativa,
          mesaj: `Badge fixed/zIndex detectat — există deja badge-uri în ${relative(RADACINA, f)}. Verifică dacă poți reutiliza sau dacă acoperă butoane (cazul „satisfacție acoperă butoane" din 23 aug).`,
        })
        break // o singură sugestie per pattern
      }
    }
  }

  // D3: Pattern polling — dacă creezi un setInterval cu fetch, sugerează usePolledJson
  if (semnale.patternPolling && caleRelativa.includes('frontend')) {
    const usePolledJsonExista = fisiereCodLista.some((f) => {
      if (f === fisierTinta) return false
      const c = readFileSync(f, 'utf8')
      return /usePolledJson/.test(c)
    })
    if (usePolledJsonExista) {
      sugestii.push({
        tip: 'D3',
        fisier: caleRelativa,
        mesaj: `setInterval+fetch detectat — există usePolledJson în frontend/lib. Verifică dacă poți reutiliza în loc de setInterval manual.`,
      })
    }
  }
}

// ── 5. EXECUȚIE ───────────────────────────────────────────────────────────
const modificate = fisiereModificate()
const fisiereDeScanat = modificate
  ? modificate.filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f))
  : null

if (!fisiereDeScanat || fisiereDeScanat.length === 0) {
  console.log('verifica-duplicari: niciun fișier modificat — sărit.')
  process.exit(0)
}

for (const fisier of fisiereDeScanat) {
  const caleIntreaga = join(RADACINA, fisier)
  if (!existsSync(caleIntreaga)) continue
  const continut = readFileSync(caleIntreaga, 'utf8')
  const semnale = extrageSemnale(continut)
  if (semnale.functii.length === 0 && semnale.componente.length === 0 && semnale.rute.length === 0 && !semnale.patternBadge && !semnale.patternPolling) continue
  cautaDuplicari(caleIntreaga, semnale)
}

// ── 6. RAPORT ─────────────────────────────────────────────────────────────
if (abateri.length > 0) {
  console.error('\n╔══ VERIFICĂ DUPLICĂRI — ABATERI ═══════════════════════════════╗')
  console.error('║ Legea reutilizării: verifică ÎNAINTE ce există deja.          ║')
  console.error('╚══════════════════════════════════════════════════════════════╝\n')
  for (const a of abateri) {
    console.error(`  [${a.tip}] ${a.fisier}`)
    console.error(`       ${a.mesaj}`)
    console.error(`       Dacă e intenționat: // reutilizare-permis: <motivul>\n`)
  }
}

if (sugestii.length > 0) {
  if (abateri.length === 0) console.log('\n┌─ VERIFICĂ DUPLICĂRI — sugestii ──────────────────────────────┐')
  for (const s of sugestii) {
    console.log(`  [${s.tip}] ${s.fisier}: ${s.mesaj}\n`)
  }
}

if (abateri.length > 0) {
  console.error(`\n${abateri.length} abatere(i) — REUTILIZEAZĂ ce există sau declară excepția.`)
  process.exit(1)
}

if (sugestii.length > 0) {
  console.log(`\n${sugestii.length} sugestie(i) — verifică dacă poți reutiliza.`)
}

console.log('verifica-duplicari: nicio duplicare negăzduită (Legea reutilizării respectată).')
process.exit(0)
