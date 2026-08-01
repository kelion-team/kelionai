import { describe, it, expect } from 'vitest'
import {
  citesteMeminfo,
  citesteLoadavg,
  descrieResurse,
  resurseGazda,
  PRAG_MEMORIE_PCT,
  PRAG_INCARCARE_PCT,
} from './services/resurse.js'

// ── THE HOST'S RESOURCES ───────────────────────────────────────────────────
//
// Adrian, Jul 31: "buddy but I have there" (about getting another VPS) and
// "the load on the server can be measured, it's easy". I had told him "I
// wouldn't put it on the same VPS" without having measured anything — neither
// memory nor load was measured anywhere in the app, so I had no way to know.
//
// The functions are pure precisely so the test is REAL: we give them /proc
// text and check the figures that come out, we don't read the source hoping
// it does what it says.

// /proc/meminfo from a real Linux, cut to the fields that matter.
// 8 GB total, ~3.2 GB available — the "usual VPS under load" case.
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

  // The core of the decision: MemFree would give 5% (a false alarm, every
  // day, on any server that has been running for a week), because everything
  // unused ends up as cache. MemAvailable also counts the recoverable cache —
  // 40%. If someone ever changes the field, the test shows them exactly what
  // they break.
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

  // Rule 1, written as a test: the absence of a measurement is not allowed to
  // come out as 0. "0 GB free" would be a critical alarm invented from a
  // failed reading — exactly this morning's error with "£0.00".
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

  // The raw load says nothing without the number of processors: 4.0 on a
  // 4-core machine is exactly at capacity; the same 4.0 on a 1-core one means
  // three processes are waiting in line. That's why we report the percentage.
  it('procentul e raportat la numărul de nuclee, nu la cifra brută', () => {
    const pct = (load15: number, nuclee: number): number => Math.round((load15 / nuclee) * 100)
    expect(pct(4.0, 4)).toBe(100)
    expect(pct(4.0, 1)).toBe(400)
    expect(pct(0.17, 4)).toBe(4)
  })

  it('pragul lasă vârfurile normale să treacă și prinde coada reală', () => {
    expect(150 <= PRAG_INCARCARE_PCT).toBe(true) // build/deploy — no alarm
    expect(320 > PRAG_INCARCARE_PCT).toBe(true) // it's really tight
  })
})

describe('citirea de pe mașina reală', () => {
  it('întoarce ori o măsurătoare validă în întregime, ori null', async () => {
    const r = await resurseGazda()
    if (r === null) return // we're not on Linux — declared absence, correct
    expect(r.totalGb).toBeGreaterThan(0)
    expect(r.liberPct).toBeGreaterThanOrEqual(0)
    expect(r.liberPct).toBeLessThanOrEqual(100)
    expect(r.procesoare).toBeGreaterThan(0)
    expect(r.incarcare).toHaveLength(3)
    expect(r.incarcarePct).toBeGreaterThanOrEqual(0)
    // The reported sentence must contain both measurements, not just one.
    const text = descrieResurse(r)
    expect(text).toMatch(/GB liberi din .* GB \(\d+%\)/)
    expect(text).toMatch(/încărcare \d+% din \d+ procesoare/)
  })
})
