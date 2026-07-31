import { describe, it, expect } from 'vitest'
import { citesteMeminfo, descrieMemoria, PRAG_MEMORIE_PCT, memorieGazda } from './services/memorie.js'

// ── MEMORIA GAZDEI ──────────────────────────────────────────────────────────
//
// Adrian, 31 iul: „prietene dar eu am acolo" — despre a mai lua un VPS pentru
// un al doilea agent. Îi spusesem „n-aș pune-o pe același VPS" fără să fi
// măsurat nimic; memoria nu era măsurată nicăieri în aplicație, deci n-aveam
// de unde ști. Testul ăsta păzește măsurătoarea care lipsea.
//
// Funcția e pură tocmai ca testul să fie REAL: îi dăm text de /proc/meminfo și
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

describe('citirea memoriei gazdei', () => {
  it('scoate cifrele corect din /proc/meminfo real', () => {
    const m = citesteMeminfo(MEMINFO_8GB, 4)
    expect(m).not.toBeNull()
    expect(m!.totalGb).toBeCloseTo(7.76, 1)
    expect(m!.liberGb).toBeCloseTo(3.13, 1)
    expect(m!.liberPct).toBe(40)
    expect(m!.procesoare).toBe(4)
  })

  // Miezul deciziei de azi: MemFree ar da 5% (alarmă falsă, în fiecare zi, pe
  // orice server care rulează de o săptămână), fiindcă tot ce nu e folosit
  // ajunge cache. MemAvailable numără și cache-ul recuperabil — 40%. Dacă
  // cineva schimbă vreodată câmpul, testul îi arată exact ce strică.
  it('folosește MemAvailable, nu MemFree — altfel alarme false zilnic', () => {
    const m = citesteMeminfo(MEMINFO_8GB)!
    const pctDupaMemFree = Math.round((412340 / 8138752) * 100)
    expect(pctDupaMemFree).toBe(5)
    expect(m.liberPct).toBe(40)
    expect(m.liberPct).not.toBe(pctDupaMemFree)
  })

  it('sub prag se aprinde, peste prag nu', () => {
    const stramt = citesteMeminfo(`MemTotal:        8138752 kB\nMemAvailable:     407000 kB\n`)!
    expect(stramt.liberPct).toBe(5)
    expect(stramt.liberPct <= PRAG_MEMORIE_PCT).toBe(true)

    const larg = citesteMeminfo(MEMINFO_8GB)!
    expect(larg.liberPct <= PRAG_MEMORIE_PCT).toBe(false)
  })

  // Regula 1, scrisă ca test: lipsa unei măsurători nu are voie să iasă ca 0.
  // „0 GB liberi" ar fi o alarmă critică inventată dintr-o citire eșuată —
  // exact eroarea de azi-dimineață cu „£0.00".
  it('text invalid dă null — lipsa nu se raportează ca zero', () => {
    expect(citesteMeminfo('')).toBeNull()
    expect(citesteMeminfo('cu totul altceva\n')).toBeNull()
    expect(citesteMeminfo('MemTotal:              0 kB\nMemAvailable:  0 kB\n')).toBeNull()
  })

  it('fraza raportată conține și cifrele, și procentul', () => {
    expect(descrieMemoria(citesteMeminfo(MEMINFO_8GB)!)).toBe('3.1 GB liberi din 7.8 GB (40%)')
  })

  it('citirea de pe mașina reală întoarce ori o măsurătoare validă, ori null', async () => {
    const m = await memorieGazda()
    if (m === null) return // nu suntem pe Linux — lipsă declarată, corect
    expect(m.totalGb).toBeGreaterThan(0)
    expect(m.liberPct).toBeGreaterThanOrEqual(0)
    expect(m.liberPct).toBeLessThanOrEqual(100)
    expect(m.procesoare).toBeGreaterThan(0)
  })
})
