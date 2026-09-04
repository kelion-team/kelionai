import { describe, it, expect } from 'vitest'
import { raportPostMortem, type UrmaTab } from './lib/errorReport'

// ── DE CE EXISTĂ TESTUL ĂSTA ────────────────────────────────────────────────
// În jurnalul serverului, „chatul audio live crapă aplicația" arăta așa:
// sesiunea Realtime se deschidea, apoi venea `POST /api/client-errors`, apoi
// `GET /` — pagina pleca. Din jurnal NU se putea spune dacă pleacă pentru că o
// cheamă codul nostru (reload de service worker, logout) sau pentru că procesul
// de randare a MURIT (OOM / crash / TWA repornit). Discriminatorul măsurabil
// este `pagehide`: se dă la orice plecare normală și NU se dă la un crash.
// Funcția probată aici transformă urma lăsată în tab exact în verdictul ăla.

const urma = (extra: Partial<UrmaTab> = {}): UrmaTab => ({
  v: 1,
  at: 1_000_000,
  faza: 'voce:gata',
  ...extra,
})

describe('post-mortem: de ce a plecat pagina precedentă', () => {
  it('prima încărcare (fără urmă) nu inventează nimic', () => {
    expect(raportPostMortem(null, 'navigate', 1_000_000)).toBeNull()
  })

  it('urmă de altă versiune este ignorată, nu interpretată', () => {
    const vechi = { v: 2, at: 1, faza: 'x' } as unknown as UrmaTab
    expect(raportPostMortem(vechi, 'reload', 2)).toBeNull()
  })

  it('plecare CURATĂ: motivul marcat de cod ajunge în verdict', () => {
    const raport = raportPostMortem(
      urma({ motivPlecare: 'reload:sw-controllerchange', heapMb: 120 }),
      'reload',
      1_003_000,
    )
    expect(raport).toContain('a plecat CURAT')
    expect(raport).toContain('motiv=reload:sw-controllerchange')
    expect(raport).toContain('faza=voce:gata')
    expect(raport).toContain('nav=reload')
    expect(raport).toContain('heap=120MB')
    expect(raport).toContain('dupa 3s')
  })

  it('MOARTE: fără `pagehide` verdictul spune crash de randare, nu reload', () => {
    const raport = raportPostMortem(urma({ heapMb: 1_900 }), 'reload', 1_004_000)
    expect(raport).toContain('a MURIT fara pagehide')
    expect(raport).toContain('NU un reload din cod')
    // Faza + heapul ultim scris sunt exact contextul care lipsea: în ce punct al
    // căii vocale a murit tabul și cu cât heap în mână.
    expect(raport).toContain('faza=voce:gata')
    expect(raport).toContain('heap=1900MB')
  })

  it('heapul absent (browser fără performance.memory) nu inventează o cifră', () => {
    expect(raportPostMortem(urma(), 'navigate', 1_000_000)).not.toContain('heap=')
  })
})
