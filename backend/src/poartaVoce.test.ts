import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── POARTA DE TIMBRU (Adrian, Aug 1) ────────────────────────────────────────
// „dacă nu-mi identifică vocea trebuie să ignore ce aude — femei, bărbați, tv,
// radio" + „titularul poate cere EXPLICIT să vorbească și cu alta persoană" +
// „salvează amprenta și poza oaspetelui + relația, dar sub aprobarea
// titularului" + „la fiecare upgrade să țină minte timbrul".
//
// REGULI de neîncălcat, păzite aici:
//   1. Verdictul de timbru se AȘTEAPTĂ — nimic nu ajunge la creier înainte.
//   2. Voce străină fără oaspete = ignorată COMPLET (fără răspuns, fără
//      avertisment, fără urmă în chat).
//   3. Oaspetele (chiar aprobat) primește ZERO drepturi de admin, oricine ar
//      fi logat în sesiune.
//   4. Fereastra de oaspete se deschide NUMAI prin unealta creierului, la
//      cererea titularului.
//   5. Pragul de potrivire al oaspetelui = pragul titularului (0.38).
const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const realtime = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')
const oaspeti = readFileSync(fileURLToPath(new URL('./services/guestVoices.ts', import.meta.url)), 'utf8')
const health = readFileSync(fileURLToPath(new URL('./services/health.ts', import.meta.url)), 'utf8')

describe('verdictul de timbru se așteaptă înainte de creier', () => {
  it('tura așteaptă verdictul serverului', () => {
    expect(voce).toMatch(/await transcriptVerdict\(t, vf\)/)
  })

  it('onAddressed primește și eticheta de vorbitor (oaspete)', () => {
    expect(voce).toMatch(/onAddressed\?\.\(t, vf, speaker\)/)
  })

  it('serverul calculează guest / guestPending înainte de răspuns', () => {
    expect(realtime).toMatch(/matchApprovedGuest\(user\.email/)
    expect(realtime).toMatch(/activeGuestWindow\(user\.email\)/)
    expect(realtime).toMatch(/saveGuestVoice\(\{/)
  })
})

describe('vocea străină este ignorată COMPLET', () => {
  it('fără guest și fără guestPending, tura moare în client', () => {
    expect(voce).toMatch(/verdict\?\.foreignVoice && !guest/)
    expect(voce).toMatch(/ignorată complet/)
  })

  it('NU mai există vechiul avertisment injectat în sesiune (Kelion răspundea televizorului)', () => {
    expect(voce).not.toContain('ATENȚIE (verificare de timbru)')
    expect(voce).not.toContain('persistTranscript')
  })
})

describe('oaspetele are ZERO drepturi de admin', () => {
  it('tura de oaspete dezactivează isAdmin chiar în sesiunea titularului', () => {
    expect(chat).toMatch(/const isAdmin = user\.role === 'admin' && !guestMatch/)
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
  const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8')
  const audio = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/audioIO.ts', import.meta.url)), 'utf8')

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
