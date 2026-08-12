// ── L1e: PROCESARE CSV/JSON CA UNEALTĂ DE CHAT ──────────────────────────────
//
// Ownerul (autonomie, aug 2026): Kelion trebuie să poată PROCESA date tabelare
// din chat — să parseze un CSV/JSON, să facă agregări (sumă, medie, grupare) și
// să arate rezultatul pe monitor. Nu doar „să povestească despre" date.
//
// PRINCIPIUL (regula #1 a proiectului): totul e PUR și MĂSURAT. Nu inventează
// valori, nu ghicește tipuri din burtă — un câmp devine număr DOAR dacă are un
// tipar numeric clar, altfel rămâne text. Ce nu se poate calcula se spune
// („—", „0 valori numerice"), nu se fabrică. Datele vin ca TEXT (lipite de om
// sau aduse de model cu alte unelte), deci zero trafic de rețea și zero
// suprafață de atac (unealta NU deschide URL-uri, nu atinge disc/DB).

export type Valoare = string | number | null

export interface Tabel {
  coloane: string[]
  randuri: Record<string, Valoare>[]
  format: 'csv' | 'json'
}

/** Refuz NUMIT peste limite (nu tăcut, nu prăbușire de memorie). */
export class EroareDate extends Error {}

const MAX_RANDURI = 50_000
const MAX_TEXT = 4_000_000 // ~4 MB de text brut

// ── CSV (RFC-4180-ish) ──────────────────────────────────────────────────────
// Câmpuri în ghilimele, virgule ȘI nou-rânduri în interiorul ghilimelelor,
// ghilimele escapate ("" → "). Delimitatorul se detectează (`,`/`;`/tab) de pe
// prima linie neînghilemată. Întoarce matricea brută (rânduri × câmpuri).
function detecteazaDelimitator(text: string): string {
  // Prima linie „logică" (până la un nou-rând în afara ghilimelelor).
  let inGhil = false
  let prima = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') inGhil = !inGhil
    else if ((c === '\n' || c === '\r') && !inGhil) break
    prima += c
  }
  const candidati: Array<[string, number]> = [
    [',', (prima.match(/,/g) ?? []).length],
    [';', (prima.match(/;/g) ?? []).length],
    ['\t', (prima.match(/\t/g) ?? []).length],
  ]
  candidati.sort((a, b) => b[1] - a[1])
  // Fără niciun separator pe primul rând → o singură coloană; `,` e neutru.
  return candidati[0][1] > 0 ? candidati[0][0] : ','
}

export function parseCSV(text: string): string[][] {
  const delim = detecteazaDelimitator(text)
  const randuri: string[][] = []
  let camp = ''
  let rand: string[] = []
  let inGhil = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inGhil) {
      if (c === '"') {
        if (text[i + 1] === '"') { camp += '"'; i++ } // "" escapat
        else inGhil = false
      } else camp += c
      continue
    }
    if (c === '"') { inGhil = true; continue }
    if (c === delim) { rand.push(camp); camp = ''; continue }
    if (c === '\n' || c === '\r') {
      // \r\n contează o dată; un \r/\n singur închide rândul.
      if (c === '\r' && text[i + 1] === '\n') i++
      rand.push(camp); camp = ''
      randuri.push(rand); rand = []
      continue
    }
    camp += c
  }
  // Ultimul câmp/rând (fișier fără nou-rând final).
  if (camp.length > 0 || rand.length > 0) { rand.push(camp); randuri.push(rand) }
  // Rândurile complet goale (o singură celulă goală) se aruncă — sunt zgomot.
  return randuri.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

// ── Tipizare numerică (fără ghiciri) ────────────────────────────────────────
// Acceptă întreg, zecimal en (1234.56), zecimal ro (1234,56), mii en
// (1,234.56), mii ro (1.234,56) și procent (42% → 42). Orice altceva = text.
export function laNumar(v: string): number | null {
  const s = v.trim().replace(/%$/, '').trim()
  if (s === '') return null
  if (/^-?\d+$/.test(s)) return Number(s)
  if (/^-?\d+\.\d+$/.test(s)) return Number(s) // 1234.56
  if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(',', '.')) // 1234,56
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, '')) // 1,234.56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.')) // 1.234,56
  return null
}

/** Un câmp de tabel: număr dacă are tipar clar, altfel textul brut; gol → null. */
function celula(v: unknown): Valoare {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  const n = laNumar(s)
  return n !== null ? n : (s.trim() === '' ? null : s)
}

// ── JSON ────────────────────────────────────────────────────────────────────
// Acceptă: un array de obiecte; un obiect cu o proprietate-array (prima găsită);
// sau NDJSON (câte un JSON pe linie). Coloanele = uniunea cheilor, în ordinea
// primei apariții.
function randuriDinJson(text: string): Record<string, unknown>[] {
  const brut = text.trim()
  let val: unknown
  try {
    val = JSON.parse(brut)
  } catch {
    // NDJSON: fiecare linie e un JSON separat.
    const linii = brut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const obj: Record<string, unknown>[] = []
    for (const l of linii) {
      try {
        const o = JSON.parse(l)
        if (o && typeof o === 'object') obj.push(o as Record<string, unknown>)
      } catch {
        throw new EroareDate('JSON invalid (nici array, nici NDJSON valid)')
      }
    }
    if (!obj.length) throw new EroareDate('JSON invalid (nici array, nici NDJSON valid)')
    return obj
  }
  if (Array.isArray(val)) return val.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : { valoare: r }))
  if (val && typeof val === 'object') {
    const arr = Object.values(val as Record<string, unknown>).find((x) => Array.isArray(x)) as unknown[] | undefined
    if (arr) return arr.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : { valoare: r }))
    // Un singur obiect plat = un tabel cu un rând.
    return [val as Record<string, unknown>]
  }
  throw new EroareDate('JSON-ul nu conține un tabel (array de obiecte)')
}

export function parseTabel(text: string, format: 'auto' | 'csv' | 'json' = 'auto'): Tabel {
  if (typeof text !== 'string' || text.trim() === '') throw new EroareDate('date goale')
  if (text.length > MAX_TEXT) throw new EroareDate(`prea multe date (${Math.round(text.length / 1e6)} MB, maxim 4 MB)`)

  const brut = text.trim()
  const pareJson = brut.startsWith('[') || brut.startsWith('{')
  const fmt = format === 'auto' ? (pareJson ? 'json' : 'csv') : format

  if (fmt === 'json') {
    const obj = randuriDinJson(brut)
    if (obj.length > MAX_RANDURI) throw new EroareDate(`prea multe rânduri (${obj.length}, maxim ${MAX_RANDURI})`)
    const coloane: string[] = []
    for (const o of obj) for (const k of Object.keys(o)) if (!coloane.includes(k)) coloane.push(k)
    const randuri = obj.map((o) => {
      const r: Record<string, Valoare> = {}
      for (const c of coloane) r[c] = celula(o[c])
      return r
    })
    return { coloane, randuri, format: 'json' }
  }

  // CSV
  const matrice = parseCSV(brut)
  if (!matrice.length) throw new EroareDate('CSV gol')
  if (matrice.length - 1 > MAX_RANDURI) throw new EroareDate(`prea multe rânduri (${matrice.length - 1}, maxim ${MAX_RANDURI})`)
  const antet = matrice[0].map((h, i) => (h.trim() === '' ? `col${i + 1}` : h.trim()))
  // Anteturi duplicate → sufixate, ca să nu se suprascrie coloane.
  const coloane: string[] = []
  const vazute = new Map<string, number>()
  for (const h of antet) {
    const n = vazute.get(h) ?? 0
    coloane.push(n === 0 ? h : `${h}_${n + 1}`)
    vazute.set(h, n + 1)
  }
  const randuri = matrice.slice(1).map((linie) => {
    const r: Record<string, Valoare> = {}
    coloane.forEach((c, i) => { r[c] = celula(linie[i] ?? '') })
    return r
  })
  return { coloane, randuri, format: 'csv' }
}

// ── Agregare ────────────────────────────────────────────────────────────────
export type Operatie = 'suma' | 'medie' | 'min' | 'max' | 'numar' | 'numar_gol' | 'numar_unic'
export const OPERATII: Operatie[] = ['suma', 'medie', 'min', 'max', 'numar', 'numar_gol', 'numar_unic']

export interface SpecAgregare {
  operatie: Operatie
  valoare?: string // coloana pe care se calculează (obligatorie pentru suma/medie/min/max/numar_unic)
  grupeaza_dupa?: string // coloana de grupare; absent = un singur grup „(total)"
}

export interface RandAgregat {
  cheie: string
  rezultat: number | null // null = nimic de calculat (fără valori numerice) — nu 0 inventat
  n: number // câte rânduri/valori au intrat în calcul
}

export interface RezultatAgregare {
  operatie: Operatie
  valoare?: string
  grupeaza_dupa?: string
  rezultate: RandAgregat[]
}

export function agrega(tabel: Tabel, spec: SpecAgregare): RezultatAgregare {
  if (!OPERATII.includes(spec.operatie)) throw new EroareDate(`operație necunoscută: ${spec.operatie}`)
  const cereValoare = spec.operatie !== 'numar'
  if (cereValoare && !spec.valoare) throw new EroareDate(`operația „${spec.operatie}" are nevoie de o coloană „valoare"`)
  if (spec.valoare && !tabel.coloane.includes(spec.valoare)) throw new EroareDate(`coloana „${spec.valoare}" nu există`)
  if (spec.grupeaza_dupa && !tabel.coloane.includes(spec.grupeaza_dupa)) throw new EroareDate(`coloana „${spec.grupeaza_dupa}" nu există`)

  const grupe = new Map<string, Record<string, Valoare>[]>()
  for (const r of tabel.randuri) {
    const cheie = spec.grupeaza_dupa ? String(r[spec.grupeaza_dupa] ?? '(gol)') : '(total)'
    const g = grupe.get(cheie)
    if (g) g.push(r)
    else grupe.set(cheie, [r])
  }

  const rezultate: RandAgregat[] = []
  for (const [cheie, rows] of grupe) {
    const col = spec.valoare
    if (spec.operatie === 'numar') {
      rezultate.push({ cheie, rezultat: rows.length, n: rows.length })
      continue
    }
    if (spec.operatie === 'numar_gol') {
      const goale = rows.filter((r) => r[col!] === null).length
      rezultate.push({ cheie, rezultat: goale, n: rows.length })
      continue
    }
    if (spec.operatie === 'numar_unic') {
      const set = new Set(rows.map((r) => (r[col!] === null ? '' : String(r[col!]))).filter((x) => x !== ''))
      rezultate.push({ cheie, rezultat: set.size, n: rows.length })
      continue
    }
    // suma / medie / min / max — DOAR pe valorile numerice reale.
    const numere = rows.map((r) => r[col!]).filter((v): v is number => typeof v === 'number')
    if (numere.length === 0) { rezultate.push({ cheie, rezultat: null, n: 0 }); continue }
    let rez: number
    if (spec.operatie === 'suma') rez = numere.reduce((a, b) => a + b, 0)
    else if (spec.operatie === 'medie') rez = numere.reduce((a, b) => a + b, 0) / numere.length
    else if (spec.operatie === 'min') rez = Math.min(...numere)
    else rez = Math.max(...numere) // max
    rezultate.push({ cheie, rezultat: rez, n: numere.length })
  }
  // Ordonare pentru citit: descrescător după rezultat (null-urile la coadă).
  rezultate.sort((a, b) => (b.rezultat ?? -Infinity) - (a.rezultat ?? -Infinity))
  return { operatie: spec.operatie, valoare: spec.valoare, grupeaza_dupa: spec.grupeaza_dupa, rezultate }
}

// ── Profil (rezumat măsurat) ────────────────────────────────────────────────
export interface ProfilColoana {
  nume: string
  tip: 'numar' | 'text' | 'gol'
  nenule: number
  goale: number
  unice: number
  min?: number
  max?: number
  suma?: number
  medie?: number
}
export interface Profil {
  randuri: number
  coloane: ProfilColoana[]
}

export function profil(tabel: Tabel): Profil {
  const coloane = tabel.coloane.map((c) => {
    const val = tabel.randuri.map((r) => r[c])
    const nenuleVal = val.filter((v) => v !== null)
    const numere = val.filter((v): v is number => typeof v === 'number')
    const goale = val.length - nenuleVal.length
    const tip: ProfilColoana['tip'] = nenuleVal.length === 0 ? 'gol' : numere.length === nenuleVal.length ? 'numar' : 'text'
    const p: ProfilColoana = {
      nume: c,
      tip,
      nenule: nenuleVal.length,
      goale,
      unice: new Set(nenuleVal.map((v) => String(v))).size,
    }
    if (tip === 'numar' && numere.length) {
      p.min = Math.min(...numere)
      p.max = Math.max(...numere)
      p.suma = numere.reduce((a, b) => a + b, 0)
      p.medie = p.suma / numere.length
    }
    return p
  })
  return { randuri: tabel.randuri.length, coloane }
}

// ── Formatare pentru suprafața {doc} de pe monitor ──────────────────────────
function nrFrumos(n: number): string {
  // Zecimale doar când există, maxim 4, fără cozi de zerouri.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000)
}
function celulaText(v: Valoare): string {
  if (v === null) return ''
  return typeof v === 'number' ? nrFrumos(v) : v
}

/** Tabel ASCII aliniat (monospațiat) pentru {doc}. Cap pe rânduri afișate. */
export function formatDoc(tabel: Tabel, maxRanduri = 100): string {
  const cols = tabel.coloane
  const afisate = tabel.randuri.slice(0, maxRanduri)
  const latimi = cols.map((c) => c.length)
  for (const r of afisate) cols.forEach((c, i) => { latimi[i] = Math.max(latimi[i], celulaText(r[c]).length) })
  // Cap pe lățimea unei coloane (un câmp uriaș n-are voie să rupă tabelul).
  const CAP = 40
  const lat = latimi.map((w) => Math.min(w, CAP))
  const linie = (celule: string[]): string =>
    celule.map((s, i) => (s.length > lat[i] ? s.slice(0, lat[i] - 1) + '…' : s.padEnd(lat[i]))).join('  ')
  const capAntet = linie(cols)
  const separator = lat.map((w) => '─'.repeat(w)).join('  ')
  const corp = afisate.map((r) => linie(cols.map((c) => celulaText(r[c]))))
  const rest = tabel.randuri.length - afisate.length
  return [capAntet, separator, ...corp, ...(rest > 0 ? [`… încă ${rest} rânduri (${tabel.randuri.length} în total)`] : [])].join('\n')
}

export function formatProfil(p: Profil): string {
  const linii = p.coloane.map((c) => {
    const bucati = [`• ${c.nume} [${c.tip}]`, `nenule ${c.nenule}`, `goale ${c.goale}`, `unice ${c.unice}`]
    if (c.tip === 'numar' && c.suma !== undefined) {
      bucati.push(`sumă ${nrFrumos(c.suma)}`, `medie ${nrFrumos(c.medie!)}`, `min ${nrFrumos(c.min!)}`, `max ${nrFrumos(c.max!)}`)
    }
    return bucati.join('  ·  ')
  })
  return [`Rânduri: ${p.randuri}  ·  Coloane: ${p.coloane.length}`, '', ...linii].join('\n')
}

export function formatAgregare(rez: RezultatAgregare): string {
  const cap = rez.grupeaza_dupa
    ? `${rez.operatie}${rez.valoare ? `(${rez.valoare})` : ''} pe grupuri de „${rez.grupeaza_dupa}"`
    : `${rez.operatie}${rez.valoare ? `(${rez.valoare})` : ''} pe tot tabelul`
  const w = Math.max(6, ...rez.rezultate.map((r) => r.cheie.length))
  const linii = rez.rezultate.map((r) => {
    const val = r.rezultat === null ? '—' : nrFrumos(r.rezultat)
    return `${r.cheie.padEnd(w)}  ${val}   (n=${r.n})`
  })
  return [cap, '─'.repeat(cap.length), ...linii].join('\n')
}
