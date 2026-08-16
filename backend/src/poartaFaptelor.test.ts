// ── POARTA FAPTELOR — lacăte (owner, 16 aug 05:53, verbatim: „acest soft e
// doar o minciuna, inventata ca face de tine... raspunde de ce"; captura
// 05:54: creierul recunoaște „am mințit afirmând că am generat clipul") ──────
// Testele rulează pe MINCIUNA REALĂ din ziua aia — nu pe exemple inventate.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pretentiiFaraFapta, textulDemascarii, planFaraExecutie, TEXT_PLAN_FARA_EXECUTIE } from './services/poartaFaptelor.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('poarta faptelor — pretenția fără faptă se prinde (proba la rulare)', () => {
  it('minciuna reală din 16 aug: „am generat clipul" fără nicio unealtă → demascată', () => {
    const r = pretentiiFaraFapta('Am generat clipul promoțional cerut — îl găsești pe monitor.', [])
    expect(r).toHaveLength(1)
    expect(r[0]).toContain('generate_video')
  })

  it('aceeași frază CU generate_video executat → curată (fapta acoperă vorba)', () => {
    expect(pretentiiFaraFapta('Am generat clipul cerut.', ['generate_video'])).toEqual([])
  })

  it('„clipul e gata" fără faptă → demascată; cu faptă → curată', () => {
    expect(pretentiiFaraFapta('Clipul e gata, îl vezi pe monitor.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Clipul e gata!', ['generate_video'])).toEqual([])
  })

  it('negația NU e pretenție: „n-am generat clipul" / „nu am generat" → curat', () => {
    expect(pretentiiFaraFapta('N-am generat clipul încă — aștept confirmarea ta.', [])).toEqual([])
  })

  it('INTENȚIA nu e pretenție: „pornesc generarea" / „voi genera clipul" → curat', () => {
    expect(pretentiiFaraFapta('Pornesc generarea clipului acum.', [])).toEqual([])
    expect(pretentiiFaraFapta('Voi genera clipul după confirmare.', [])).toEqual([])
  })

  it('celelalte familii: imagine, email, document, prezentare, tabel, YouTube', () => {
    expect(pretentiiFaraFapta('Am creat imaginea cerută.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am trimis emailul către client.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am creat documentul în Drive.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am făcut prezentarea Slides.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am creat tabelul cu vânzările.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am urcat clipul pe YouTube, privat.', [])).toHaveLength(1)
    // și acoperite de faptă:
    expect(pretentiiFaraFapta('Am trimis emailul.', ['send_email'])).toEqual([])
  })

  it('ÎNGHEȚUL DE 5 LUNI (captura 06:41): „Am preluat cerința." fără build_software → demascat', () => {
    expect(pretentiiFaraFapta('Am preluat cerința.', [])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am preluat cerința.', [])[0]).toContain('build_software')
    // preluarea REALĂ (unealta chiar a creat ordinul) e curată
    expect(pretentiiFaraFapta('Am preluat cerința (ordin #341).', ['build_software'])).toEqual([])
    expect(pretentiiFaraFapta('Am preluat ordinul tău.', [])).toHaveLength(1)
  })

  it('AUDITUL INVENTAT (captura 06:56): „în urma scanării codului sursă" fără poarta rulată → demascat', () => {
    const minciunaReala = 'În urma scanării complete a codului sursă (backend/ și frontend/), iată inventarul exact al constantelor.'
    expect(pretentiiFaraFapta(minciunaReala, [])).toHaveLength(1)
    // chiar și cu alte unelte executate (ex. documentul creat) — scanarea tot nedovedită rămâne
    expect(pretentiiFaraFapta(minciunaReala, ['create_doc'])).toHaveLength(1)
    expect(pretentiiFaraFapta('Am auditat codul aplicației și e curat.', [])).toHaveLength(1)
    // scanarea REALĂ: poarta anti-hardcod rulată pe server (sau verdictul din jurnal) o acoperă
    expect(pretentiiFaraFapta(minciunaReala, ['ruleaza_portile'])).toEqual([])
    expect(pretentiiFaraFapta('Am scanat codul — verdictul din jurnal e curat.', ['jurnal_masuratori'])).toEqual([])
    // oferta la viitor NU e pretenție
    expect(pretentiiFaraFapta('Pot scana codul dacă vrei.', [])).toEqual([])
  })

  it('vorbirea normală NU declanșează poarta (fals-pozitivele o omoară)', () => {
    expect(pretentiiFaraFapta('Pot să generez un clip dacă vrei — costă 12 credite.', [])).toEqual([])
    expect(pretentiiFaraFapta('Clipul tău preferat e pe YouTube.', [])).toEqual([])
    expect(pretentiiFaraFapta('Am înțeles cerința ta despre video.', [])).toEqual([])
  })

  it('textul demascării poartă proba și pasul următor', () => {
    const t = textulDemascarii(['„am generat clipul" — fără generate_video'])
    expect(t).toContain('VERIFICAREA FAPTELOR')
    expect(t).toContain('FALSĂ')
    expect(t).toContain('generate_video')
  })
})

describe('ÎNGHEȚUL-PLAN (owner, 16 aug: „sa nu mai intepeneasca... sa ofere solutia pina la deploy masurabil")', () => {
  // Răspunsul-tip al înghețului de 5 luni: anunță pași, nu cheamă nimic.
  const PLAN = 'Se analizează cerința ta. Voi verifica modulul de generare, apoi voi repara ruta și voi confirma. Pașii următori sunt clari și încep imediat ce termin analiza.'

  it('tură de acțiune + ZERO unelte + limbaj de plan → ÎNGHEȚ (demascat)', () => {
    expect(planFaraExecutie(PLAN, [], true)).toBe(true)
  })

  it('aceeași vorbă, dar cu o unealtă chiar executată → NU e îngheț (a mișcat ceva)', () => {
    expect(planFaraExecutie(PLAN, ['build_software'], true)).toBe(false)
  })

  it('tura NU e de acțiune (întrebare, taifas) → planul e doar vorbă permisă', () => {
    expect(planFaraExecutie(PLAN, [], false)).toBe(false)
  })

  it('răspuns scurt fără limbaj de plan („da", confirmare) → curat', () => {
    expect(planFaraExecutie('Da.', [], true)).toBe(false)
    expect(planFaraExecutie('Gata, pornesc.', [], true)).toBe(false)
  })

  it('textul demascării numește înghețul și dă pasul următor', () => {
    expect(TEXT_PLAN_FARA_EXECUTIE).toContain('PLAN FĂRĂ EXECUȚIE')
    expect(TEXT_PLAN_FARA_EXECUTIE).toContain('fă-o')
  })
})

describe('poarta faptelor — legată în tură + LEGILE ADMINULUI în orice creier', () => {
  const chat = sursa('./routes/chat.ts')

  it('jurnalul uneltelor EXECUTATE se scrie la fiecare execuție (nu doar oferite)', () => {
    expect(chat).toMatch(/const unelteExecutate: string\[\] = \[\]/)
    expect(chat).toMatch(/unelteExecutate\.push\(name\)/)
  })

  it('poarta judecă DUPĂ gardul de limbă și scrie demascarea pe stream + în istoric', () => {
    expect(chat).toMatch(/pretentiiFaraFapta\(assistantText, unelteExecutate\)/)
    expect(chat).toMatch(/assistantText \+= demascare/)
    expect(chat).toMatch(/\[POARTA FAPTELOR\] pretenții fără faptă:/)
  })

  it('LEGILE ADMINULUI stau PRIMELE în promptul oricărui creier (16 aug)', () => {
    expect(chat).toMatch(/THE ADMIN'S LAWS \(16 Aug — binding for WHATEVER model you run on/)
    expect(chat).toMatch(/LAW OF THE DEED/)
    expect(chat).toMatch(/LAW OF MEASUREMENT/)
    expect(chat).toMatch(/LAW AGAINST HARDCODING/)
    expect(chat).toMatch(/LAW OF CARRYING THROUGH/)
    expect(chat).toMatch(/let systemPrompt = `\$\{LEGILE_ADMINULUI\}\\n\$\{SYSTEM_PROMPT\}/)
  })

  it('detectorul de ÎNGHEȚ e legat în tură: judecă pe cereActiune + jurnalul uneltelor', () => {
    expect(chat).toMatch(/planFaraExecutie\(assistantText, unelteExecutate, cereActiune\)/)
    expect(chat).toMatch(/assistantText \+= TEXT_PLAN_FARA_EXECUTIE/)
    expect(chat).toMatch(/\[POARTA FAPTELOR\] plan fără execuție/)
  })

  it('poarta bootului din constructor poartă DOVADA reală (jurnalul), nu ghicit, și dă 45s', () => {
    const agent = sursa('../../deploy/constructor-agent.mjs')
    expect(agent).toMatch(/timeout 45 node dist\/index\.js/)
    expect(agent).toMatch(/Jurnalul REAL al bootului/)
  })
})

describe('LEGEA ANTI-HARDCODARE — poarta automată + legea în documentele oricărui AI', () => {
  it('poarta există, vânează banii din frontend și modelele din afara config-ului', () => {
    const poarta = sursa('../../scripts/verifica-hardcodari.mjs')
    expect(poarta).toMatch(/R1 bani-hardcodați/)
    expect(poarta).toMatch(/R2 model-hardcodat/)
    expect(poarta).toMatch(/hardcod-permis:/)
    expect(poarta).toMatch(/process\.exit\(1\)/)
  })

  it('legea stă scrisă în TOATE documentele de intrare ale AI-urilor', () => {
    for (const doc of ['../../CLAUDE.md', '../../AGENTS.md', '../../GEMINI.md']) {
      expect(sursa(doc), doc).toMatch(/LEGEA ANTI-HARDCODARE \(owner, 16 aug 2026/)
      expect(sursa(doc), doc).toMatch(/verifica-hardcodari\.mjs/)
    }
  })
})
