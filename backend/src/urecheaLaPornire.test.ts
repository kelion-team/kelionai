// Microfonul pornește numai după intenția explicită a persoanei. După aceea,
// revenirea în tab poate reconecta sesiunea dorită, fără a reactiva un microfon
// oprit manual.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const panou = sursa('../../frontend/src/components/ChatPanel.tsx')
const vocal = sursa('../../frontend/src/lib/vocalLive.ts')
const ruta = sursa('./routes/vocalLive.ts')

describe('P21 — veriga 1: urechea pornește numai după intenție', () => {
  it('nu există auto-start la avatar sau la un temporizator de pornire', () => {
    expect(panou).not.toMatch(/addEventListener\('kelion:avatar-ready'/)
    expect(panou).not.toMatch(/setTimeout\(arm, 4000\)/)
    expect(panou).toMatch(/const micManualOffRef = useRef\(true\)/)
  })

  it('revenirea în tab reconectează numai o ureche pornită explicit', () => {
    expect(panou).toMatch(/document\.visibilityState === 'visible' && !micManualOffRef\.current[\s\S]{0,100}ensureMicRef\.current\(\)/)
    expect(panou).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/)
  })

  it('oprirea MANUALĂ e respectată — nimic nu pornește peste alegerea omului', () => {
    expect(panou).toMatch(/async function ensureMic\(\)[\s\S]{0,260}vlRef\.current \|\|[\s\S]{0,100}micStartingRef\.current \|\|[\s\S]{0,100}micManualOffRef\.current \|\|[\s\S]{0,100}\)\s*return/)
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
  it('user NOU fără preferință → engleză; limba detectată a contului câștigă pentru orice rol', () => {
    expect(ruta).toMatch(/let limbaPin = 'en-US'/)
    expect(ruta).toMatch(/const selected = selectVoiceLocale\(pref\)/)
    expect(ruta).not.toMatch(/if \(isAdminSession\) limbaPin = 'ro-RO'/)
  })

  it('userul cu limbă SETATĂ o primește pe a lui (preferința citită din DB)', () => {
    expect(ruta).toMatch(/const pref = await getSpeechLang\(user\.email\)/)
    expect(ruta).toMatch(/const selected = selectVoiceLocale\(pref\)/)
  })

  it('limba VORBITĂ constant se ține minte (trackSpeechLang → setSpeechLangPref) — data viitoare urechea se deschide direct pe ea', () => {
    expect(ruta).toMatch(/trackSpeechLang/)
    expect(ruta).toMatch(/setSpeechLangPref/)
  })
})
