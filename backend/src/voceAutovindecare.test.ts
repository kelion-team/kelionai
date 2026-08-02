import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── AUTOVINDECAREA VOCII (Adrian, Aug 2 — „solutions, not patches") ─────────
// Live data, Aug 2: 57 "voce realtime a picat" in 24h. Three proven bugs:
//   1. THE CHIRP EAR died on any WS drop (one per redeploy) and the death
//      mark was PERMANENT → every later session landed on the zero-credit
//      OpenAI reserve → mic totally dead.
//   2. Bare typed tool calls (`get_weather`) reached the chat bubble.
//   3. The mouth's probe got ONE 401 (session not ready) → OpenAI mouth →
//      connection-failed → Kelion MUTE; and /api/realtime/tick pulsed even
//      in Chirp-mouth mode.
// The frontend has no test runner; we read it from here, like
// urechiChirp.test.ts / guraChirp.test.ts.

const mic = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/micStream.ts', import.meta.url)), 'utf8')
const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const panou = readFileSync(fileURLToPath(new URL('../../frontend/src/components/ChatPanel.tsx', import.meta.url)), 'utf8')
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('urechea Chirp se AUTOVINDECĂ: reconnect transparent, buget limitat', () => {
  it('bugetul e 5 reconectări în orice fereastră de 60s, apoi escaladare', () => {
    expect(mic).toMatch(/RECONNECT_BUDGET = 5/)
    expect(mic).toMatch(/RECONNECT_WINDOW_MS = 60_000/)
    // escaladarea (fallbackToBatch) există DOAR după epuizarea bugetului
    const idxBudget = mic.indexOf('reconnectsAt.length >= RECONNECT_BUDGET')
    expect(idxBudget).toBeGreaterThanOrEqual(0)
    expect(mic.slice(idxBudget, idxBudget + 300)).toMatch(/fallbackToBatch\(\)/)
  })
  it('la reconnect se redeschide WS-ul și se retrimite {type:start, lang}', () => {
    expect(mic).toMatch(/const openWs = \(\): void => \{/)
    expect(mic).toMatch(/sock\.send\(JSON\.stringify\(\{ type: 'start', lang: opts\.getLang\(\) \}\)\)/)
    expect(mic).toMatch(/scheduleReconnect = \(\): void/)
  })
  it('un stop() curat NU reconectează NICIODATĂ (timerul moare cu sesiunea)', () => {
    expect(mic).toMatch(/if \(closed \|\| sock !== ws\) return \/\/ clean stop\(\) or a stale socket — NEVER reconnect/)
    const idxStop = mic.indexOf('const stop = (): void => {')
    expect(mic.slice(idxStop, idxStop + 700)).toMatch(/clearTimeout\(reconnectTimer\)/)
  })
  it('plasa de siguranță „silent" (15s) se REARMEAZĂ la fiecare reconnect', () => {
    const idx = mic.indexOf('const scheduleReconnect')
    const body = mic.slice(idx, idx + 1200)
    expect(body).toMatch(/clearTimeout\(silentTimer\)/)
    expect(body).toMatch(/sentAudio = false/)
    expect(body).toMatch(/gotAnyMsg = false/)
  })
  it('refuzul de config (1011 asr_not_configured) NU se reîncearcă — cooldown + batch', () => {
    expect(mic).toMatch(/ev\.code === 1011 \|\| ev\.reason === 'asr_not_configured'/)
    const idx = mic.indexOf("ev.reason === 'asr_not_configured'")
    expect(mic.slice(idx, idx + 300)).toMatch(/markUrechiIndisponibile\(\)/)
  })
})

describe('moartea urechii e un COOLDOWN, nu o condamnare pe viață', () => {
  it('marchează 60s, apoi /api/asr-stream/capability se re-sondează', () => {
    expect(mic).toMatch(/URECHI_COOLDOWN_MS = 60_000/)
    expect(mic).toMatch(/chirpEarCooldownUntil = Date\.now\(\) \+ URECHI_COOLDOWN_MS/)
    expect(mic).toMatch(/streamingAsrAvailable === false && Date\.now\(\) >= chirpEarCooldownUntil/)
  })
  it('marcheazaUrechiChirpMoarte trece prin cooldown (marca rămâne, dar cu expirare)', () => {
    const idx = mic.indexOf('export function marcheazaUrechiChirpMoarte')
    expect(mic.slice(idx, idx + 200)).toMatch(/markUrechiIndisponibile\(\)/)
    expect(mic).toMatch(/streamingAsrAvailable = false/)
  })
})

describe('track-ended: microfonul se redeschide O DATĂ înainte de escaladare', () => {
  it('re-deschiderea trece prin același openMicGraph și reface graful în loc', () => {
    expect(mic).toMatch(/let micReopened = false/)
    expect(mic).toMatch(/openMicGraph\(\(\) => \{\}, null\)/)
    expect(mic).toMatch(/wireGraph\(g\)/)
  })
  it('a doua moarte a track-ului (sau redeschidere eșuată) escaladează ca înainte', () => {
    expect(mic).toMatch(/onError\('track-ended'\)/)
  })
})

describe('proba gurii: 401 NU e un verdict — se re-sondează la următorul start', () => {
  it('un răspuns non-OK nu se cache-uiește; doar corpul 200 decide modul', () => {
    const idxProbe = voce.indexOf("fetch('/api/tts/status'")
    const idxNotOk = voce.indexOf('if (!r.ok) return false', idxProbe)
    const idxCache = voce.indexOf('guraChirpStare = ok', idxProbe)
    expect(idxNotOk).toBeGreaterThan(idxProbe)
    expect(idxCache).toBeGreaterThan(idxNotOk) // caching happens only AFTER the ok gate
  })
  it('proba picată (rețea) nu lasă modul rezervă lipit pe sesiune', () => {
    expect(voce).toMatch(/\.catch\(\(\) => false\)/)
    const hits = voce.match(/guraChirpStare = ok/g) ?? []
    expect(hits.length).toBe(1) // o singură atribuire, în spatele porții r.ok
  })
})

describe('contorul de voce pulsează în ORICE mod (prețul produsului, nu al furnizorului)', () => {
  it('pulsul pe minut nu mai e oprit de modul gură-Chirp', () => {
    // Aug 2: oprit în mod Chirp, pulsul făcea vocea GRATIS pentru toți userii —
    // modelul ownerului e invers: userii plătesc credite, furnizorii sunt free.
    expect(panou).not.toMatch(/rv\.guraChirp === true \? null : window\.setInterval/)
    expect(panou).toMatch(/const voiceTick = window\.setInterval/)
  })
  it('OWNERUL nu se debitaeză singur (realtime.ts: isOwner → fără debit, charged 0)', () => {
    const rt = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')
    expect(rt).toMatch(/const isOwner = user\.email\.toLowerCase\(\) === config\.adminEmail/)
    expect(rt).toMatch(/if \(!isOwner\) void debitWallet/)
    expect(rt).toMatch(/charged: isOwner \? 0 : cost/)
  })
})

describe('când AMBELE guri pică, omul aude O DATĂ, onest — nu 57 de bucle mute', () => {
  it('statusul onest apare o singură dată pe cădere (latch), în chat', () => {
    expect(panou).toMatch(/voiceDownAckedRef/)
    // Auditul din 2 aug: literalul englez a devenit cheia i18n voiceDownTemp,
    // iar 401/402 au mesajele lor specifice (voiceNeedLogin/voiceNeedCredit) —
    // un om fără credit nu mai aude „temporar" cu promisiune falsă de retry.
    expect(panou).toMatch(/ack\(t\.voiceDownTemp\)/)
    const hits = panou.match(/voiceDownAckedRef\.current = true/g) ?? []
    expect(hits.length).toBe(3) // punctele de latch: onState('error') + catch (401/402 specific + generic)
  })
  it('restartul după eroarea realtime are BACKOFF (nu bucla strânsă de 57 de ori)', () => {
    const hits =
      panou.match(/micRetryRef\.current = window\.setTimeout\(\(\) => void ensureMicRef\.current\(\), micBackoffRef\.current\)/g) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(2) // onMicErr + calea de eroare realtime
  })
  it('un „live" re-armează anunțul (o pană viitoare se anunță din nou, tot o dată)', () => {
    expect(panou).toMatch(/voiceDownAckedRef\.current = false/)
  })
})

describe('apelurile tastate goale nu ajung la om (chat.ts leagă numele turei)', () => {
  it('setul de nume vine din uneltele OFERITE tura asta — niciodată hardcodat', () => {
    expect(chat).toMatch(/const toolNamesThisTurn = new Set\(tools\.map\(\(t\) => t\.name\)\)/)
  })
  it('stripper-ul de streaming ȘI textul final primesc setul de nume', () => {
    expect(chat).toMatch(/makeToolMarkupStripper\([\s\S]{0,200}toolNamesThisTurn,?\s*\)/)
    expect(chat).toMatch(/stripToolMarkup\(r\.text, undefined, toolNamesThisTurn\)/)
  })
})
