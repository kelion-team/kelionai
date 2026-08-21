import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  stareSesiune,
  pastreazaStareSesiune,
  actualizeazaStareSesiune,
  uitaStareSesiune,
  TTL_SESIUNE_MS,
} from './services/stareSesiune.js'

// ── VERIFICĂRILE SE FAC LA LOGARE, NU LA FIECARE ÎNTREBARE (Adrian, 7 aug) ────
// „verificarile de plati etc securitate se fac la logare si atit, e clar nu se
// repeta deloc pe intrebari" + „nu viziteaza tot continentul sa raspunda".
// Testele astea păzesc regula: preferințele de cont se citesc O DATĂ și se
// servesc din memorie; ce ține de SECURITATE rămâne per-tură, neatins.

const stare = (over = {}) => ({
  speechLang: 'ro', meserieId: null, disabledGestures: [],
  modelChoiceKv: null, voicePref: null, balance: null, ...over,
})

describe('starea de sesiune se citește o dată, nu la fiecare întrebare', () => {
  beforeEach(() => uitaStareSesiune('a@b.c'))

  it('prima întrebare nu găsește nimic (se va citi din DB), a doua o ia din memorie', () => {
    expect(stareSesiune('a@b.c', 1000)).toBeNull()
    pastreazaStareSesiune('a@b.c', stare(), 1000)
    expect(stareSesiune('a@b.c', 1001)?.speechLang).toBe('ro')
  })

  it('starea expiră după TTL — plasă de siguranță, nu se servește la infinit', () => {
    pastreazaStareSesiune('a@b.c', stare(), 1000)
    expect(stareSesiune('a@b.c', 1000 + TTL_SESIUNE_MS + 1)).toBeNull()
  })

  it('o valoare schimbată se actualizează în memorie, fără recitire din DB', () => {
    pastreazaStareSesiune('a@b.c', stare(), 1000)
    actualizeazaStareSesiune('a@b.c', { speechLang: 'en' })
    expect(stareSesiune('a@b.c', 1001)?.speechLang).toBe('en')
  })

  it('deconectarea uită contul — următoarea sesiune recitește curat', () => {
    pastreazaStareSesiune('a@b.c', stare(), 1000)
    uitaStareSesiune('a@b.c')
    expect(stareSesiune('a@b.c', 1001)).toBeNull()
  })

  it('conturile nu se amestecă între ele', () => {
    pastreazaStareSesiune('a@b.c', stare({ speechLang: 'ro' }), 1000)
    pastreazaStareSesiune('x@y.z', stare({ speechLang: 'en' }), 1000)
    expect(stareSesiune('a@b.c', 1001)?.speechLang).toBe('ro')
    expect(stareSesiune('x@y.z', 1001)?.speechLang).toBe('en')
    uitaStareSesiune('x@y.z')
  })
})

describe('chat.ts chiar folosește starea, și NU slăbește securitatea', () => {
  const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

  it('preferințele de cont vin din starea sesiunii, nu dintr-o citire per-tură', () => {
    expect(chat).toMatch(/const cache = stareSesiune\(user\.email, acumMs\)/)
    expect(chat).toMatch(/pastreazaStareSesiune\(user\.email, stare, acumMs\)/)
  })

  it('preferințele (inclusiv vocea) NU se recitesc per-tură — vin din starea sesiunii', () => {
    // Voce SCOASĂ (clean-slate 21 aug): sinteza Chirp de pe calea scrisă a
    // dispărut, deci nu mai există `createVoiceStream`. Ce rămâne verificat e
    // regula de viteză: preferințele nu se cer printr-un `await getVoicePref`
    // separat înainte de creier — vin din batch-ul de sesiune.
    expect(chat).not.toMatch(/createVoiceStream/)
    expect(chat).not.toMatch(/await getVoicePref\(user\.email\)/)
  })

  it('limba confirmată actualizează memoria, ca următoarea tură să n-o ia veche', () => {
    expect(chat).toMatch(/actualizeazaStareSesiune\(user\.email, \{ speechLang: committedLang \}\)/)
  })

  it('SECURITATEA rămâne per-tură: isAdmin se recalculează la fiecare cerere', () => {
    // Regula ownerului e despre VITEZĂ (preferințe recitite degeaba), nu despre
    // a slăbi gardul. isAdmin depinde de CINE vorbește în tura curentă (oaspete,
    // voce nevalidată) — nu are ce căuta într-un cache de sesiune.
    expect(chat).toMatch(/const isAdmin = user\.role === 'admin' && !guestMatch\n/)
    // isAdmin nu se citește NICIODATĂ din cache (ar fi `cache.isAdmin`/`prefs.isAdmin`)
    expect(chat).not.toMatch(/(?:cache|prefs)\.isAdmin/)
  })
})
