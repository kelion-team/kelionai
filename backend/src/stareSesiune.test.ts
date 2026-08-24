import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  stareSesiune,
  pastreazaStareSesiune,
  actualizeazaStareSesiune,
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

let emailSeq = 0
let email = ''

describe('starea de sesiune se citește o dată, nu la fiecare întrebare', () => {
  beforeEach(() => { email = `session-${++emailSeq}@example.test` })

  it('prima întrebare nu găsește nimic (se va citi din DB), a doua o ia din memorie', () => {
    expect(stareSesiune(email, 1000)).toBeNull()
    pastreazaStareSesiune(email, stare(), 1000)
    expect(stareSesiune(email, 1001)?.speechLang).toBe('ro')
  })

  it('starea expiră după TTL — plasă de siguranță, nu se servește la infinit', () => {
    pastreazaStareSesiune(email, stare(), 1000)
    expect(stareSesiune(email, 1000 + TTL_SESIUNE_MS + 1)).toBeNull()
  })

  it('o valoare schimbată se actualizează în memorie, fără recitire din DB', () => {
    pastreazaStareSesiune(email, stare(), 1000)
    actualizeazaStareSesiune(email, { speechLang: 'en' })
    expect(stareSesiune(email, 1001)?.speechLang).toBe('en')
  })

  it('conturile nu se amestecă între ele', () => {
    pastreazaStareSesiune(email, stare({ speechLang: 'ro' }), 1000)
    pastreazaStareSesiune('x@y.z', stare({ speechLang: 'en' }), 1000)
    expect(stareSesiune(email, 1001)?.speechLang).toBe('ro')
    expect(stareSesiune('x@y.z', 1001)?.speechLang).toBe('en')
  })
})

describe('chat.ts chiar folosește starea, și NU slăbește securitatea', () => {
  const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

  it('preferințele de cont vin din starea sesiunii, nu dintr-o citire per-tură', () => {
    expect(chat).toMatch(/const cache = stareSesiune\(user\.email, acumMs\)/)
    expect(chat).toMatch(/pastreazaStareSesiune\(user\.email, stare, acumMs\)/)
  })

  it('preferința de voce NU mai e a treia interogare pe user_prefs în aceeași tură', () => {
    // Înainte: `await getVoicePref(user.email)` chiar înainte de apelul la creier.
    expect(chat).toMatch(/createVoiceStream\(reply, userLang, prefs\.voicePref, user\.email, clientKey, replayLeaseToken\)/)
    expect(chat).toMatch(/usageContext: \{ userEmail, surface: 'chat_tts' \}/)
    expect(chat.match(/synthesize\(t, lang/g)).toHaveLength(1)
    expect(chat).toMatch(/executeChatSideEffect\(\s*\{ userEmail, idempotencyKey, leaseToken \}/)
    expect(chat).not.toMatch(/await getVoicePref\(user\.email\)/)
  })

  it('limba confirmată actualizează memoria, ca următoarea tură să n-o ia veche', () => {
    expect(chat).toMatch(/actualizeazaStareSesiune\(user\.email, \{ speechLang: committedLang \}\)/)
  })

  it('SECURITATEA rămâne per-tură: adminul se derivă din emailul verificat', () => {
    // Identitatea privilegiată nu are ce căuta într-un cache de preferințe.
    expect(chat).toMatch(/const isAdminUser = esteAdminKelion\(user\.email\)/)
    // isAdmin nu se citește NICIODATĂ din cache (ar fi `cache.isAdmin`/`prefs.isAdmin`)
    expect(chat).not.toMatch(/(?:cache|prefs)\.isAdmin/)
  })
})
