import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── VOCEA MERGE DIRECT LA CREIER (Adrian, 6 aug) ────────────────────────────
// SCHIMBARE MAJORĂ (Adrian, 6 aug: „elimină intermediarii, îl pui direct pe Kelion
// să primească; scoate orice urmă de limitare a audio, scoate-i și din soft").
// Poarta de TIMBRU de pe CLIENT (al doilea upload al frazei + un await serial
// înainte de creier) a fost SCOASĂ — adăuga secunde pe fiecare tură. Fraza brută
// pleacă acum DIRECT la creierul unic (Gemini 3 Pro), care decide singur adresarea.
//
// CE RĂMÂNE (server-side, NU în calea vocii):
//   • uneltele de oaspeți + înrolarea amprentei din panou (guestVoices, /transcript);
//   • gardul de admin din chat.ts (isAdmin && !nevalidat) — dormant pe voce acum,
//     dar păzit ca să nu fie scos „din greșeală";
//   • operațiile sensibile (card/bani) rămân gardate de potrivirea reală holder.
// Testele de mai jos păzesc noul contract: NIMIC în calea vocii nu blochează audio-ul.
const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const realtime = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const oaspeti = readFileSync(fileURLToPath(new URL('./services/guestVoices.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const health = readFileSync(fileURLToPath(new URL('./services/health.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('calea vocii merge DIRECT la creier (fără verdict de timbru în cale)', () => {
  it('fraza pleacă DIRECT la creier — NICIUN verdict de timbru în cale (Adrian, 6 aug)', () => {
    // INTERMEDIARI SCOȘI (Adrian, 6 aug: „elimină intermediarii, îl pui direct pe
    // Kelion să primească; scoate orice urmă de limitare a audio, scoate-i și din
    // soft"). Verdictul de timbru era un al DOILEA upload al frazei + un await serial
    // înainte de creier. A fost SCOS DE TOT. Dacă cineva îl re-adaugă, testul cade.
    expect(voce).not.toMatch(/transcriptVerdict/)
    expect(voce).not.toMatch(/realtime\/transcript/)
  })

  it('onAddressed duce fraza brută DIRECT la creier (speaker undefined — fără verdict)', () => {
    expect(voce).toMatch(/onAddressed\?\.\('', vf, undefined, audio\)/)
  })

  it('serverul calculează guest / guestPending înainte de răspuns', () => {
    expect(realtime).toMatch(/matchApprovedGuest\(user\.email/)
    expect(realtime).toMatch(/activeGuestWindow\(user\.email\)/)
    expect(realtime).toMatch(/saveGuestVoice\(\{/)
  })
})

describe('clientul nu mai etichetează timbrul — fraza pleacă direct, negată de nimic', () => {
  // INTERMEDIARI SCOȘI (Adrian, 6 aug). Clientul NU mai calculează pe voce niciun
  // `nevalidat`/`foreignVoice` și nu mai face al doilea upload — fraza brută pleacă
  // DIRECT la creier, care decide adresarea. Gardul de admin din chat.ts rămâne
  // (isAdmin && !nevalidat) — dormant pe voce acum, dar păzit mai jos; operațiile
  // sensibile (card/bani) rămân gardate SERVER-side de potrivirea reală holder.
  it('clientul nu mai etichetează vocea (nevalidat/foreignVoice au dispărut din calea vocii)', () => {
    expect(voce).not.toMatch(/nevalidat/)
    expect(voce).not.toMatch(/foreignVoice/)
    expect(voce).not.toMatch(/ignorată complet/)
  })

  it('NU mai există vechiul avertisment injectat în sesiune (Kelion răspundea televizorului)', () => {
    expect(voce).not.toContain('ATENȚIE (verificare de timbru)')
    expect(voce).not.toContain('persistTranscript')
  })
})

describe('oaspetele CONFIRMAT are ZERO drepturi de admin; adminul LOGAT rămâne admin', () => {
  // Owner, 14 aug: „sunt logat, ca e logat admin — să nu-mi mai dea fals". O voce
  // care nu se potrivește cu amprenta (fals-negativ) NU mai retrage adminul
  // deținătorului logat; doar un oaspete CONFIRMAT (`guest:…`) coboară tura. Deci
  // isAdmin depinde DOAR de rol + lipsa unui oaspete confirmat, nu de `nevalidat`.
  it('doar un oaspete CONFIRMAT dezactivează isAdmin — nu o amprentă vocală neprinsă', () => {
    expect(chat).toMatch(/const isAdmin = user\.role === 'admin' && !guestMatch\n/)
    // `nevalidat` nu mai poate retrage adminul (a fost scos din poartă).
    expect(chat).not.toMatch(/const isAdmin = [^\n]*!nevalidat/)
  })

  it('creierul primește nota de oaspete cu interdicții explicite', () => {
    expect(chat).toContain('NOTĂ DE SISTEM — vorbitorul este un OASPETE')
    expect(chat).toMatch(/INTERZIS: orice acțiune administrativă, financiară sau distructivă/)
  })

  it('uneltele de oaspeți sunt disponibile TUTUROR titularilor (nu doar adminului)', () => {
    // apar în AMBELE liste (admin + user) din chat.ts
    const count = chat.split('ALLOW_GUEST_VOICE_TOOL').length - 1
    expect(count).toBeGreaterThanOrEqual(3) // import + 2 liste
  })
})

describe('aprobarea și memoria oaspeților', () => {
  it('fereastra se deschide doar prin unealta creierului, cu nume', () => {
    expect(oaspeti).toMatch(/case 'allow_guest_voice'/)
    expect(oaspeti).toMatch(/no_name/)
  })

  it('pragul oaspetelui = pragul titularului (0.38), dintr-o SINGURĂ sursă', () => {
    expect(oaspeti).toMatch(/MATCH_THRESHOLD = VOICE_MATCH_THRESHOLD/)
  })

  it('respingerea șterge amprenta neaprobată', () => {
    expect(oaspeti).toMatch(/decideGuestVoice\(pending\.id, approve/)
  })
})

describe('amprentele supraviețuiesc upgrade-urilor', () => {
  it('sănătatea semnalează amprenta adminului lipsă', () => {
    expect(health).toMatch(/amprenta_admin_lipsa/)
    expect(health).toMatch(/FROM voiceprints/)
  })

  it('sănătatea numără și oaspeții aprobați', () => {
    expect(health).toMatch(/FROM voice_guests WHERE approved/)
  })
})

// Adrian, Aug 1: „am șters amprenta mea că era greșită" + „gresit, timbrul e
// masculin" — amprenta lui sărea male↔female pentru că FIECARE tură potrivită
// rescria referința cu citirea curentă (uneori armonica greșită).
describe('amprenta titularului nu mai oscilează', () => {
  const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  const audio = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/audioIO.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

  it('genul se deduce din pitch-ul MEDIAN, nu din medie (spike-urile trackeriului nu mai răstoarnă genul)', () => {
    expect(audio).toMatch(/pitchMedian/)
    expect(chat).toMatch(/inferGender\(vf\.meta\.pitchMedian \?\? vf\.meta\.pitchMean\)/)
    expect(realtime).toMatch(/inferGender\(vf\.meta\.pitchMedian \?\? vf\.meta\.pitchMean\)/)
  })

  it('adaptarea PĂSTREAZĂ genul stocat și amestecă vectorul (70/30) — niciodată rescriere oarbă', () => {
    expect(db).toMatch(/old\.gender && old\.gender !== 'unknown'\) gender = old\.gender/)
    expect(db).toMatch(/0\.7 \* old\.features\[i\] \+ 0\.3 \* x/)
  })

  it('poarta sub-armonică prinde și vocile masculine înalte (165 Hz, cu dovada autocorelației)', () => {
    expect(audio).toMatch(/sampleRate \/ maxPos > 165/)
  })
})
