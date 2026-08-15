// ── P21: URECHEA SE DESCHIDE SINGURĂ LA PORNIREA APLICAȚIEI (owner, 15 aug,
// verbatim: „cind porneste aplicatia si mic s-a activat se deschide imediat si
// urechea setata pe limba default daca e user nou sau limba setata pe user,
// e facuta asta dar nu merge, cauta si repara")
//
// Lanțul întreg, verigă cu verigă — fiecare a fost cândva ruptă și reparată;
// lacătele de aici le țin pe toate pe loc. Ce NU se poate proba de aici e
// comportamentul browserului viu (permisiunea microfonului) — aia rămâne proba
// live a ownerului; codul de dedesubt e însă întreg și încuiat.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const panou = sursa('../../frontend/src/components/ChatPanel.tsx')
const vocal = sursa('../../frontend/src/lib/vocalLive.ts')
const ruta = sursa('./routes/vocalLive.ts')

describe('P21 — veriga 1: urechea se ARMEAZĂ singură la pornire', () => {
  it('pornirea vine la kelion:avatar-ready (threadul liber), cu plasă la 4s', () => {
    expect(panou).toMatch(/addEventListener\('kelion:avatar-ready', arm, \{ once: true \}\)/)
    expect(panou).toMatch(/window\.setTimeout\(arm, 4000\)/)
  })

  it('revenirea în tab re-armează urechea (visibilitychange)', () => {
    expect(panou).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/)
  })

  it('oprirea MANUALĂ e respectată — nimic nu pornește peste alegerea omului', () => {
    expect(panou).toMatch(/if \(micRef\.current \|\| micStartingRef\.current \|\| micManualOffRef\.current\) return/)
  })
})

describe('P21 — veriga 2: urechea deschisă chiar AUDE (contextul suspendat)', () => {
  it('contextul de intrare pornit altfel decât running primește deblocarea la gest', () => {
    expect(vocal).toMatch(/if \(ctxIn\.state !== 'running'\) deblocheazaAudioLaGest\(ctxIn\)/)
  })

  it('auto-resume pe interval, cât sesiunea e vie (mobilul adoarme contextele)', () => {
    expect(vocal).toMatch(/setupAudioContextAutoResume\(ctxIn, \(\) => !inchis\)/)
    expect(vocal).toMatch(/if \(ctxIn && ctxIn\.state !== 'running'\) void ctxIn\.resume\(\)/)
  })
})

describe('P21 — veriga 3: limba urechii la deschidere (default pe user nou, a lui pe user setat)', () => {
  it('user NOU fără preferință → limba implicită a aplicației (en-US); adminul → română', () => {
    expect(ruta).toMatch(/limbaPin = 'en-US' \/\/ user nou → limba implicită a aplicației/)
    expect(ruta).toMatch(/if \(user\.role === 'admin'\) limbaPin = 'ro-RO'/)
  })

  it('userul cu limbă SETATĂ o primește pe a lui (preferința citită din DB)', () => {
    expect(ruta).toMatch(/const pref = await getSpeechLang\(user\.email\)/)
    expect(ruta).toMatch(/else if \(BCP47\[pref\]\) limbaPin = BCP47\[pref\]/)
  })

  it('limba VORBITĂ constant se ține minte (trackSpeechLang → setSpeechLangPref) — data viitoare urechea se deschide direct pe ea', () => {
    expect(ruta).toMatch(/trackSpeechLang/)
    expect(ruta).toMatch(/setSpeechLangPref/)
  })
})
