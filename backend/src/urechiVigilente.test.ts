import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE CHIRP EARS NO LONGER DIE OF SILENCE + THE INSTANT ADMIN PAGE ────────
// Adrian, Aug 2 (direct order): „un sistem de monitorizare care ține sub
// control peste tot folosirea Chirp 3 HD, și dacă pică dă mesaj adminului
// imediat".
// Live proof from his console: «urechea Chirp a murit (silent)» right after
// the server logged «10 ABORTED: Stream timed out after receiving no more
// client requests» — an IDLE timeout, repairable by keepalive/reconnect, was
// treated as fatal and the session fell onto the PAID OpenAI ears.
// These tests pin the contract:
//   1. idle silence feeds Google a keepalive frame (simulated);
//   2. a transient/idle error NEVER triggers the OpenAI-ear fallback — only
//      auth/config or an exhausted reconnect budget does;
//   3. the admin page is instant, lands in the Admin Inbox tab + email, and
//      is anti-spam (max one per cause per cooldown).

vi.mock('./db.js', () => ({ saveInboundEmail: vi.fn(async () => true) }))
vi.mock('./services/mail.js', () => ({ sendMail: vi.fn(async () => true) }))

import { saveInboundEmail } from './db.js'
import { sendMail } from './services/mail.js'
import {
  CADRU_LINISTE,
  RECONECTARI_MAX,
  ALERTA_COOLDOWN_MS,
  FEREASTRA_SANATATE_MS,
  alertaAdminUrechiChirp,
  clasificaEroareGoogle,
  noteazaEroareChirp,
  noteazaFallbackChirp,
  noteazaReconectareChirp,
  noteazaStreamChirp,
  resetUrechiChirp,
  stareUrechiChirp,
  trebuieCadruDeLiniste,
  trebuieFallbackDupaEroare,
} from './services/urechiChirp.js'

const ruta = readFileSync(fileURLToPath(new URL('./routes/asr-stream.ts', import.meta.url)), 'utf8')
const sanatate = readFileSync(fileURLToPath(new URL('./services/health.ts', import.meta.url)), 'utf8')

beforeEach(() => {
  resetUrechiChirp()
  vi.mocked(saveInboundEmail).mockClear()
  vi.mocked(sendMail).mockClear()
})

describe('clasificarea erorilor Google: idle ≠ eroare fatală', () => {
  it('semnătura EXACTĂ din live (Aug 2) e idle_timeout, nu eroare de client', () => {
    const live = { code: 10, message: '10 ABORTED: Stream timed out after receiving no more client requests.' }
    expect(clasificaEroareGoogle(live)).toBe('idle_timeout')
  })
  it('timeout de stream și fără cod numeric → tot idle_timeout', () => {
    expect(clasificaEroareGoogle(new Error('Stream timed out after receiving no more client requests'))).toBe('idle_timeout')
  })
  it('UNAVAILABLE / RST_STREAM / DEADLINE → tranzitorii (se repară prin reconnect)', () => {
    expect(clasificaEroareGoogle({ code: 14, message: '14 UNAVAILABLE: Connection reset' })).toBe('tranzitorie')
    expect(clasificaEroareGoogle({ code: 13, message: '13 INTERNAL: Received RST_STREAM with code 2' })).toBe('tranzitorie')
    expect(clasificaEroareGoogle({ code: 4, message: '4 DEADLINE_EXCEEDED' })).toBe('tranzitorie')
    expect(clasificaEroareGoogle({ code: 10, message: '10 ABORTED: Maximum stream duration exceeded' })).toBe('tranzitorie')
  })
  it('cheie rea / fără permisiune → auth (persistent, NU se vindecă prin reconnect)', () => {
    expect(clasificaEroareGoogle({ code: 16, message: '16 UNAUTHENTICATED: Request had invalid authentication credentials' })).toBe('auth')
    expect(clasificaEroareGoogle({ code: 7, message: '7 PERMISSION_DENIED' })).toBe('auth')
  })
  it('cerere invalidă (model/regiune) → config (persistent)', () => {
    expect(clasificaEroareGoogle({ code: 3, message: '3 INVALID_ARGUMENT: The model "chirp_3" does not exist in the location' })).toBe('config')
  })
  it('eroare necunoscută → tranzitorie (bugetul de reconectări o limitează)', () => {
    expect(clasificaEroareGoogle({ message: 'ceva neașteptat' })).toBe('tranzitorie')
  })
})

describe('fallback-ul pe urechile OpenAI NU se activează pe timeout tranzient', () => {
  it('idle_timeout cu buget de reconectări disponibil → NICIODATĂ fallback', () => {
    for (let r = 0; r < RECONECTARI_MAX; r++) {
      expect(trebuieFallbackDupaEroare('idle_timeout', r)).toBe(false)
      expect(trebuieFallbackDupaEroare('tranzitorie', r)).toBe(false)
    }
  })
  it('bugetul epuizat → fallback (cădere persistentă reală, adminul e anunțat)', () => {
    expect(trebuieFallbackDupaEroare('idle_timeout', RECONECTARI_MAX)).toBe(true)
    expect(trebuieFallbackDupaEroare('tranzitorie', RECONECTARI_MAX)).toBe(true)
  })
  it('auth și config → fallback IMEDIAT, fără să aștepte bugetul', () => {
    expect(trebuieFallbackDupaEroare('auth', 0)).toBe(true)
    expect(trebuieFallbackDupaEroare('config', 0)).toBe(true)
  })
})

describe('keepalive la idle (simulat): urechea nu moare în liniște', () => {
  it('cadrul de liniște e 100 ms de PCM16 mono 16 kHz, complet zero', () => {
    expect(CADRU_LINISTE.length).toBe(3200) // 1600 samples × 2 bytes = 100 ms @ 16 kHz
    expect(CADRU_LINISTE.every((b) => b === 0)).toBe(true)
  })
  it('după 5s fără audio se trimite liniște; mai devreme nu', () => {
    const t0 = 1_000_000
    expect(trebuieCadruDeLiniste(t0, t0 + 4_999)).toBe(false)
    expect(trebuieCadruDeLiniste(t0, t0 + 5_000)).toBe(true)
    expect(trebuieCadruDeLiniste(t0, t0 + 60_000)).toBe(true)
  })
  it('ruta scrie liniște spre Google doar prin predicatul de keepalive', () => {
    expect(ruta).toMatch(/trebuieCadruDeLiniste\(ultimulAudioLa, acum\)/)
    expect(ruta).toMatch(/gStream\.write\(\{ audio: CADRU_LINISTE \}/)
  })
})

describe('monitorizarea: pulsul urechilor e mereu vizibil', () => {
  it('la pornire (fără evenimente) urechile sunt sănătoase', () => {
    const s = stareUrechiChirp()
    expect(s.sanatoase).toBe(true)
    expect(s.streamuriDeschise).toBe(0)
  })
  it('erorile idle vindecate NU îmbolnăvesc urechile — se numără ca reconectări', () => {
    noteazaStreamChirp()
    noteazaEroareChirp('idle_timeout', 'Stream timed out after receiving no more client requests')
    noteazaReconectareChirp()
    const s = stareUrechiChirp()
    expect(s.sanatoase).toBe(true)
    expect(s.reconectari).toBe(1)
    expect(s.sumar).toContain('idle-timeouturi vindecate')
  })
  it('un fallback pe urechile OpenAI îmbolnăvește pulsul, apoi se vindecă după fereastră', () => {
    const t0 = 2_000_000
    noteazaFallbackChirp('16 UNAUTHENTICATED', t0)
    expect(stareUrechiChirp(t0).sanatoase).toBe(false)
    expect(stareUrechiChirp(t0 + FEREASTRA_SANATATE_MS - 1).sanatoase).toBe(false)
    expect(stareUrechiChirp(t0 + FEREASTRA_SANATATE_MS + 1).sanatoase).toBe(true)
  })
  it('eroarea auth marchează cauza în motiv', () => {
    const t0 = 3_000_000
    noteazaEroareChirp('auth', 'UNAUTHENTICATED', t0)
    const s = stareUrechiChirp(t0)
    expect(s.sanatoase).toBe(false)
    expect(s.motiv).toContain('auth')
  })
  it('health.ts expune punctul „urechi Chirp" în info + problemă la cădere', () => {
    expect(sanatate).toMatch(/stareUrechiChirp\(\)/)
    expect(sanatate).toMatch(/info\.urechiChirp = u\.sumar/)
    expect(sanatate).toMatch(/id: 'urechi_chirp_bolnave'/)
  })
})

describe('alerta admin: instant, pe ambele canale, anti-spam', () => {
  it('prima cădere ajunge IMEDIAT în Inbox-ul din Admin ȘI pe email', async () => {
    const trimisa = await alertaAdminUrechiChirp('auth', '16 UNAUTHENTICATED')
    expect(trimisa).toBe(true)
    expect(saveInboundEmail).toHaveBeenCalledTimes(1)
    const inbox = vi.mocked(saveInboundEmail).mock.calls[0][0]
    expect(inbox.from_name).toContain('monitor urechi Chirp')
    expect(inbox.subject).toContain('Chirp')
    expect(inbox.body).toContain('16 UNAUTHENTICATED')
    // (3 aug — OpenAI extirpat: nu mai există ureche de rezervă plătită; alerta
    // spune cinstit că auzul e JOS.)
    expect(inbox.body).toContain('auzul vocal e JOS')
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendMail).mock.calls[0][0].to).toContain('@')
  })
  it('anti-spam: aceeași cauză NU mai alertează în fereastra de cooldown', async () => {
    const t0 = 5_000_000
    expect(await alertaAdminUrechiChirp('auth', 'prima', ALERTA_COOLDOWN_MS, t0)).toBe(true)
    expect(await alertaAdminUrechiChirp('auth', 'a doua', ALERTA_COOLDOWN_MS, t0 + 60_000)).toBe(false)
    expect(await alertaAdminUrechiChirp('auth', 'a treia', ALERTA_COOLDOWN_MS, t0 + ALERTA_COOLDOWN_MS - 1)).toBe(false)
    expect(saveInboundEmail).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
  it('cauze diferite au cooldown-uri separate', async () => {
    const t0 = 6_000_000
    expect(await alertaAdminUrechiChirp('auth', 'x', ALERTA_COOLDOWN_MS, t0)).toBe(true)
    expect(await alertaAdminUrechiChirp('tranzitorii_epuizate', 'y', ALERTA_COOLDOWN_MS, t0 + 1_000)).toBe(true)
    expect(saveInboundEmail).toHaveBeenCalledTimes(2)
  })
  it('după cooldown se poate alerta din nou pe aceeași cauză', async () => {
    const t0 = 7_000_000
    expect(await alertaAdminUrechiChirp('auth', 'prima', ALERTA_COOLDOWN_MS, t0)).toBe(true)
    expect(await alertaAdminUrechiChirp('auth', 'după cooldown', ALERTA_COOLDOWN_MS, t0 + ALERTA_COOLDOWN_MS + 1)).toBe(true)
    expect(saveInboundEmail).toHaveBeenCalledTimes(2)
  })
  it('canalul Inbox e EXACT cel citit de /api/admin/inbound (saveInboundEmail)', async () => {
    await alertaAdminUrechiChirp('config', 'model inexistent')
    const inbox = vi.mocked(saveInboundEmail).mock.calls[0][0]
    expect(inbox.uid).toMatch(/^urechi-chirp:config:/)
    expect(inbox.from_addr).toBe('urechi-chirp@kelionai.app')
  })
})

describe('ruta: la cădere persistentă auzul COMUTĂ pe Gemini, nu moare', () => {
  // Pin rescris 3 aug seara (ordinul „auzul trebuie să fie pe Gemini", după
  // căderea Chirp cu PERMISSION_DENIED): în spatele porții nu se mai trimite
  // 'error' clientului — se pornește urechea Gemini, iar microfonul curge.
  it('în spatele porții trebuieFallbackDupaEroare pornește urechea Gemini (nu error)', () => {
    expect(ruta).toMatch(
      /trebuieFallbackDupaEroare\(cauza, reconectari, RECONECTARI_MAX\)\) \{[\s\S]{0,500}pornesteUrecheaGemini\(\)/,
    )
    // clientul NU mai primește 'error' pe această cale
    expect(ruta).not.toMatch(
      /trebuieFallbackDupaEroare\(cauza, reconectari, RECONECTARI_MAX\)\) \{[\s\S]{0,500}send\(\{ type: 'error'/,
    )
  })
  it('căderea persistentă tot anunță adminul imediat (fire-and-forget), cu mențiunea comutării', () => {
    expect(ruta).toMatch(/void alertaAdminUrechiChirp\(cauza, detail \+ '[^']*Gemini[^']*'\)/)
  })
  it('eroarea tranzitorie reconectează transparent și se contorizează', () => {
    expect(ruta).toMatch(/noteazaReconectareChirp\(\)/)
    expect(ruta).toMatch(/reconnectTimer = setTimeout\(\(\) => \{[\s\S]{0,100}startGoogle\(\)/)
  })
  it('cleanup-ul oprește și keepalive-ul și reconnect-ul în zbor', () => {
    expect(ruta).toMatch(/clearTimeout\(reconnectTimer\)/)
    expect(ruta).toMatch(/const stopGoogle = \(\): void => \{\s*stopKeepalive\(\)/)
  })
})
