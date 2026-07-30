// ── PAZNIC DE SINTAXĂ pentru fișierele pe care NU le prinde typecheck-ul ─────
//
// DE CE (Adrian, 30 iul: „caut în tot softul acolade, ghilimele sau alte semne
// care sunt greșit puse"): `tsc` acoperă .ts/.tsx, dar CSS-ul, JSON-ul și
// workflow-urile nu sunt verificate de nimeni. Un `}` în plus în CSS nu oprește
// build-ul — doar strică tăcut restul foii de stil. Un JSON rupt oprește
// pornirea aplicației abia în producție.
//
// Rulează în CI la fiecare PR și local: `node scripts/verifica-sintaxa.mjs`.
// Iese cu cod 1 la prima problemă — deci CI-ul se face roșu.
import fs from 'node:fs'
import path from 'node:path'

const SARI = new Set(['node_modules', 'dist', '.git', '.jscpd', 'coverage'])
const probleme = []

function fisiere(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SARI.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) fisiere(p, ext, out)
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

// ── JSON ─────────────────────────────────────────────────────────────────────
// tsconfig-urile sunt JSONC (comentarii + virgulă finală permise de TypeScript),
// deci le curățăm înainte de parsare — altfel am raporta erori false.
for (const f of fisiere('.', ['.json'])) {
  let t = fs.readFileSync(f, 'utf8')
  if (path.basename(f).startsWith('tsconfig')) {
    t = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  }
  try {
    JSON.parse(t)
  } catch (e) {
    probleme.push(`JSON rupt: ${f} — ${String(e.message).slice(0, 100)}`)
  }
}

// ── CSS ──────────────────────────────────────────────────────────────────────
// Fără comentarii (ele pot conține paranteze legitim), verificăm echilibrul
// semnelor: acolade, paranteze, ghilimele și apostrofuri.
for (const f of fisiere('.', ['.css'])) {
  const corp = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const nr = (s, ch) => (s.match(new RegExp(`\\${ch}`, 'g')) || []).length
  const acoladeDeschise = nr(corp, '{')
  const acoladeInchise = nr(corp, '}')
  if (acoladeDeschise !== acoladeInchise) {
    probleme.push(`CSS: ${f} — acolade dezechilibrate (${acoladeDeschise} deschise, ${acoladeInchise} închise)`)
  }
  if (nr(corp, '(') !== nr(corp, ')')) probleme.push(`CSS: ${f} — paranteze dezechilibrate`)
  if (nr(corp, '"') % 2) probleme.push(`CSS: ${f} — ghilimele impare (una neînchisă)`)
  if ((corp.match(/'/g) || []).length % 2) probleme.push(`CSS: ${f} — apostrofuri impare`)
}

// ── MARCAJE DE CONFLICT NEREZOLVATE ─────────────────────────────────────────
//
// DE CE (30 iul, greșeala mea, prinsă de CI și nu de mine): am rezolvat un merge
// cu `git add -A` fără să mă uit și am comis `<<<<<<< HEAD` în cinci fișiere —
// inclusiv în cod care rulează. `tsc` a prins-o abia la build, iar în fișierele
// pe care typecheck-ul nu le atinge (.md, .yml, .mjs) n-ar fi prins-o nimeni.
//
// Un marcaj de conflict comis nu e o scăpare de stil: e cod pe jumătate din două
// versiuni diferite. Poarta asta îl oprește ÎNAINTE de commit, în toate
// fișierele, nu doar în cele compilate.
//
// Se caută la ÎNCEPUT de linie, ca să nu dăm alarme false pe un `<<<<<<<` care
// apare într-un șir sau într-un comentariu care descrie chiar problema asta.
const MARCAJE = /^(<{7} |={7}$|>{7} )/
for (const f of fisiere('.', ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.md', '.yml', '.yaml', '.sh'])) {
  // Fișierul ăsta descrie tiparul, deci ar da alarmă pe el însuși.
  if (f.endsWith('verifica-sintaxa.mjs')) continue
  const linii = fs.readFileSync(f, 'utf8').split('\n')
  const gasite = linii
    .map((l, i) => (MARCAJE.test(l) ? i + 1 : 0))
    .filter(Boolean)
  if (gasite.length) {
    probleme.push(`MERGE NEREZOLVAT: ${f} — marcaje de conflict la liniile ${gasite.slice(0, 6).join(', ')}`)
  }
}

// ── Raport ───────────────────────────────────────────────────────────────────
if (probleme.length) {
  console.error('SEMNE GREȘIT PUSE — găsite:')
  for (const p of probleme) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('Sintaxă: JSON + CSS verificate, toate curate.')
