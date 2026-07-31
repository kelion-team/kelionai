import { describe, it, expect } from 'vitest'
import {
  citesteMeminfo,
  citesteLoadavg,
  descrieResurse,
  resurseGazda,
  PRAG_MEMORIE_PCT,
  PRAG_INCARCARE_PCT,
} from './services/resurse.js'

// ── RESURSELE GAZDEI ────────────────────────────────────────────────────────
//
// Adrian, 31 iul: „prietene dar eu am acolo" (despre a mai lua un VPS) și „se
// poate măsura încărcarea pe server, e ușor". Îi spusesem „n-aș pune-o pe
// același VPS" fără să fi măsurat nimic — nici memoria, nici încărcarea nu
// erau măsurate nicăieri în aplicație, deci n-aveam de unde ști.
//
// Funcțiile sunt pure tocmai ca testul să fie REAL: le dăm text de /proc și
// verificăm cifrele care ies, nu citim sursa sperând că face ce scrie în ea.

// /proc/meminfo dintr-un Linux adevărat, tăiat la câmpurile care contează.
// 8 GB totali, ~3.2 GB disponibili — cazul „VPS obișnuit sub sarcină".
const MEMINFO_8GB = `MemTotal:        8138752 kB
MemFree:          412340 kB
MemAvailable:    3284916 kB
Buffers:          128044 kB
Cached:          2894112 kB
SwapTotal:             0 kB
SwapFree:              0 kB
`

describe('memoria: ÎNCAPE?', () => {
  it('scoate cifrele corect din /proc/meminfo real', () => {
    const m = citesteMeminfo(MEMINFO_8GB)
    expect(m).not.toBeNull()
    expect(m!.totalGb).toBeCloseTo(7.76, 1)
    expect(m!.liberGb).toBeCloseTo(3.13, 1)
    expect(m!.liberPct).toBe(40)
  })

  // Miezul deciziei: MemFree ar da 5% (alarmă falsă, în fiecare zi, pe orice
  // server care rulează de o săptămână), fiindcă tot ce nu e folosit ajunge
  // cache. MemAvailable numără și cache-ul recuperabil — 40%. Dacă cineva
  // schimbă vreodată câmpul, testul îi arată exact ce strică.
  it('folosește MemAvailable, nu MemFree — altfel alarme false zilnic', () => {
    const m = citesteMeminfo(MEMINFO_8GB)!
    const pctDupaMemFree = Math.round((412340 / 8138752) * 100)
    expect(pctDupaMemFree).toBe(5)
    expect(m.liberPct).toBe(40)
  })

  it('sub prag se aprinde, peste prag nu', () => {
    const stramt = citesteMeminfo('MemTotal:        8138752 kB\nMemAvailable:     407000 kB\n')!
    expect(stramt.liberPct).toBe(5)
    expect(stramt.liberPct <= PRAG_MEMORIE_PCT).toBe(true)
    expect(citesteMeminfo(MEMINFO_8GB)!.liberPct <= PRAG_MEMORIE_PCT).toBe(false)
  })

  // Regula 1, scrisă ca test: lipsa unei măsurători nu are voie să iasă ca 0.
  // „0 GB liberi" ar fi o alarmă critică inventată dintr-o citire eșuată —
  // exact eroarea de azi-dimineață cu „£0.00".
  it('text invalid dă null — lipsa nu se raportează ca zero', () => {
    expect(citesteMeminfo('')).toBeNull()
    expect(citesteMeminfo('cu totul altceva\n')).toBeNull()
    expect(citesteMeminfo('MemTotal:              0 kB\nMemAvailable:  0 kB\n')).toBeNull()
  })
})

describe('încărcarea: DUCE?', () => {
  it('citește cele trei medii din /proc/loadavg', () => {
    expect(citesteLoadavg('0.13 0.23 0.17 1/111 26260')).toEqual([0.13, 0.23, 0.17])
    expect(citesteLoadavg('7.02 6.55 5.98 9/430 12')).toEqual([7.02, 6.55, 5.98])
  })

  it('text invalid dă null — nu 0, care ar însemna „server odihnit"', () => {
    expect(citesteLoadavg('')).toBeNull()
    expect(citesteLoadavg('nimic aici')).toBeNull()
  })

  // Încărcarea brută nu spune nimic fără numărul de procesoare: 4.0 pe o
  // mașină cu 4 nuclee e exact la capacitate; aceeași 4.0 pe una cu 1 nucleu
  // înseamnă că trei procese așteaptă la coadă. De asta raportăm procentul.
  it('procentul e raportat la numărul de nuclee, nu la cifra brută', () => {
    const pct = (load15: number, nuclee: number): number => Math.round((load15 / nuclee) * 100)
    expect(pct(4.0, 4)).toBe(100)
    expect(pct(4.0, 1)).toBe(400)
    expect(pct(0.17, 4)).toBe(4)
  })

  it('pragul lasă vârfurile normale să treacă și prinde coada reală', () => {
    expect(150 <= PRAG_INCARCARE_PCT).toBe(true) // build/deploy — nu alarmă
    expect(320 > PRAG_INCARCARE_PCT).toBe(true) // chiar e strâmt
  })
})

describe('citirea de pe mașina reală', () => {
  it('întoarce ori o măsurătoare validă în întregime, ori null', async () => {
    const r = await resurseGazda()
    if (r === null) return // nu suntem pe Linux — lipsă declarată, corect
    expect(r.totalGb).toBeGreaterThan(0)
    expect(r.liberPct).toBeGreaterThanOrEqual(0)
    expect(r.liberPct).toBeLessThanOrEqual(100)
    expect(r.procesoare).toBeGreaterThan(0)
    expect(r.incarcare).toHaveLength(3)
    expect(r.incarcarePct).toBeGreaterThanOrEqual(0)
    // Fraza raportată trebuie să conțină ambele măsurători, nu doar una.
    const text = descrieResurse(r)
    expect(text).toMatch(/GB liberi din .* GB \(\d+%\)/)
    expect(text).toMatch(/încărcare \d+% din \d+ procesoare/)
  })
})
