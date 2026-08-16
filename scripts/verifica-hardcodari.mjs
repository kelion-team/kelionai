#!/usr/bin/env node
// ── LEGEA ANTI-HARDCODARE — poarta AUTOMATĂ (owner, 16 aug 2026, verbatim) ───
// „creiaza legi si mecanisme automate de cautare a hardocodului pe aplicatie,
//  si explicat oricarui ai vine foarte clare ca nu e admis hardcodat"
//
// CE VÂNEAZĂ (clasele care l-au ars pe owner, nu stil):
//   R1. CIFRE DE BANI înfipte în frontend (prețuri/credite/£/$ în stringuri):
//       cifra arătată omului TREBUIE să vină din server (lista_tarife /
//       money-circuit) — o cifră scrisă de mână minte în ziua în care se
//       schimbă tariful. (Măsurat: creierul a spus 24/48/200 când tarifele
//       reale erau 6/12/50 — clasa asta de minciună începe cu hardcodul.)
//   R2. NUME DE MODELE AI înfipte în cod în afara config.ts: modelul se
//       schimbă din env/config, nu cu foarfeca prin cod (postmortemul
//       „creier 2 503": un model pensionat hardcodat a tăcut zile întregi).
//
// EXCEPȚIA SE DECLARĂ LA FAȚA LOCULUI, cu motiv: pe aceeași linie —
//   // hardcod-permis: <motivul concret>
// Fără motiv scris = poarta pică. Lista de excepții NU e ascunsă într-un
// fișier separat — stă lângă faptă, ca s-o vadă oricine citește codul.
//
// Rulare: node scripts/verifica-hardcodari.mjs   (exit 1 = hardcod negăzduit)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RADACINA = new URL('..', import.meta.url).pathname

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

const abateri = []

function scaneaza(cale, regula, re, scutit) {
  const text = readFileSync(cale, 'utf8')
  const linii = text.split('\n')
  linii.forEach((linie, i) => {
    // comentariile pure nu afișează nimic omului — nu-s hardcod viu
    const curata = linie.replace(/^\s*(\/\/|\*|\/\*).*$/, '')
    if (!curata.trim()) return
    if (scutit && scutit.test(curata)) return
    if (linie.includes('hardcod-permis:')) return // excepție DECLARATĂ, cu motiv
    const m = re.exec(curata)
    if (m) abateri.push(`${regula} ${cale.replace(RADACINA, '')}:${i + 1} → „${m[0].trim().slice(0, 60)}"`)
  })
}

// R1 — cifre de bani în frontend (stringurile pe care le vede omul).
for (const f of fisiere(join(RADACINA, 'frontend/src'), ['.ts', '.tsx'])) {
  if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue
  scaneaza(
    f,
    '[R1 bani-hardcodați]',
    /['"`][^'"`]*(?:\d+(?:[.,]\d+)?\s*(?:credite\b|credits\b)|[£$]\s*\d)[^'"`]*['"`]/u,
    // scutit structural: chei de obiecte/CSS și interpolări pure (cifra vine din variabilă)
    /className|style=|px|rem|em\b|%|\.replace\(|\$\{[^}]*\}/,
  )
}

// R2 — nume de modele AI în afara config-ului (backend + frontend).
for (const rad of ['backend/src', 'frontend/src']) {
  for (const f of fisiere(join(RADACINA, rad), ['.ts', '.tsx'])) {
    if (f.endsWith('config.ts') || f.includes('.test.')) continue
    scaneaza(f, '[R2 model-hardcodat]', /['"`](?:gemini-\d[\w.-]*|veo-\d[\w.-]*|claude-[a-z0-9][\w.-]*)['"`]/, null)
  }
}

if (abateri.length) {
  console.error(`Hardcodări NEGĂZDUITE (${abateri.length}) — LEGEA din 16 aug: nu e admis hardcodat pe aplicație.`)
  console.error('Ori muți valoarea într-o sursă vie (config/env/kv/server), ori declari PE LINIE excepția cu motiv: // hardcod-permis: <de ce>')
  for (const a of abateri) console.error('  ' + a)
  process.exit(1)
}
console.log('Hardcodări: nicio abatere negăzduită (LEGEA din 16 aug respectată).')
