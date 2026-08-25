// ── P20: AUDITUL MULTI-AGENT PE TOT LANȚUL CHATULUI (15 aug 2026) ───────────
// (owner, verbatim: „deci atentie maxima, vreau tu si toti agenti sa faca un
// audit si reparatie pe tot chatul, nu mai vreau sa mai vad balari in chat sau
// vocea lui sa lipseasca" + „folosesti tot ce ai la dispozitie, inclusiv la
// verificare toti agenti")
//
// 24 de constatări găsite de 6 auditori, 23 CONFIRMATE adversarial de câte un
// verificator care a încercat să le respingă pe cod. Lacătele de aici țin
// reparațiile confirmate pe loc — fiecare `it` numește constatarea lui.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { memorieUnificata } from './services/memorieUnificata.js'
import { construiesteInstructiune } from './services/vocalLive.js'

const aici = dirname(fileURLToPath(import.meta.url))
const ruta = readFileSync(join(aici, 'routes/vocalLive.ts'), 'utf8')
const chat = readFileSync(join(aici, 'routes/chat.ts'), 'utf8')
const clientVL = readFileSync(join(aici, '../../frontend/src/lib/vocalLive.ts'), 'utf8')
const panou = readFileSync(join(aici, '../../frontend/src/components/ChatPanel.tsx'), 'utf8')

describe('P20 — porțile de verdict ale rutei vocale (constatările critice)', () => {
  it('tura cu verdict NEDECIS nu se mai salvează fără numele măsurat (istoricul nu se otrăvește)', () => {
    // onTuraGata ȘI incheieTura: null + fără nume → nesalvat, cu jurnal
    const aparitii = ruta.match(/verdictTura === null && !turaAdresata\(bufUser\.trim\(\)\)/g) ?? []
    expect(aparitii.length).toBeGreaterThanOrEqual(2)
    expect(ruta).toMatch(/tură nesalvată (?:la închidere )?\(tăcere corectă, fără nume\)/)
  })

  it('false-ul ceasului de 1500ms e PROVIZORIU — numele sosit târziu învie tura', () => {
    expect(ruta).toMatch(/verdictDinCeas = true/)
    // rejudecarea acceptă și false-ul provizoriu, nu doar null
    expect(ruta).toMatch(/verdictTura === null \|\| \(verdictTura === false && verdictDinCeas\)/)
    // cadrele NU se mai aruncă la expirare — se țin, mărginit, pentru înviere
    expect(ruta).toMatch(/ținute pentru învierea pe nume târziu — mărginit/)
  })

  it('negativul NU se mai încuie pe fragment PARȚIAL de transcriere („Hei" înaintea lui „Kelion")', () => {
    // la primul cadru cu temei, lipsa numelui NU pune verdict false — cadrul așteaptă
    // (linia 1389: const adresata = turaAdresataAcum(), urmată de if pe linia 1392
    //  — cu app.log.info între, deci \s* în loc de \n direct)
    expect(ruta).toMatch(/const adresata = turaAdresataAcum\(\)[\s\S]{0,500}?if \(!adresata && !turaDeSistem\) \{/)
    // în onTranscriereUser, false definitiv doar pe transcript FINAL
    expect(ruta).toMatch(/else if \(final && verdictTura === null\) \{/)
  })

  it('gardul de limbă judecă ÎNAINTE de livrare: cadrele așteaptă verdictul, cu fail-open 700ms', () => {
    expect(ruta).toMatch(/asteaptaVerdictLimba/)
    expect(ruta).toMatch(/gard de limbă fail-open: transcrierea răspunsului n-a sosit în 700 ms/)
  })

  it('suprimarea de limbă corectează sesiunea Realtime curentă fără mecanism de reluare inventat', () => {
    expect(ruta).toMatch(/live\?\.ancoreaza\(`\[SISTEM\] Replica ta anterioară a fost respinsă/)
    expect(ruta).not.toMatch(/sessionResumption|reluareInitial|suprimariLimba >=/)
  })

  it('limba se RE-JUDECĂ pe continuare (≤240 car.) — „Bine. Não sei…" nu mai trece', () => {
    expect(ruta).toMatch(/continuareStraina/)
    expect(ruta).toMatch(/bufKelion\.trim\(\)\.length <= 240/)
  })

  it('comutarea LEGITIMĂ nu se mai suprimă: omul care vorbește el însuși limba aia deschide gardul', () => {
    expect(ruta).toMatch(/limbaUser !== straina/)
  })

  it('anunțul de sistem sosit în timpul unei ture în zbor se AMÂNĂ, nu deturnează verdictul', () => {
    // JARVIS pas 2: amânarea armează și steagul de temei (anuntSistemAmanat),
    // ca exempția cățelului să călătorească CU anunțul — forma e acum pe bloc.
    expect(ruta).toMatch(/if \(turaInZbor\) \{\s*\n\s*anuntAmanat = true\s*\n\s*anuntSistemAmanat = true/)
    // transferul la tura curată există în onTuraGata și onIntrerupt
    const transferuri = ruta.match(/anuntAmanat = false/g) ?? []
    expect(transferuri.length).toBeGreaterThanOrEqual(2)
  })

  it('ambientalul nu se mai LIPEȘTE de fraza adresată: bufferul fără nume se golește la pauză', () => {
    expect(ruta).toMatch(/vorbire neadresată aruncată la pauză/)
  })

  it('limba vorbită se COMITE ca preferință (ca pe scris) — starea mută se vindecă singură', () => {
    expect(ruta).toMatch(/trackSpeechLang\(user\.email, rostire, prefLimbaCurenta\)/)
    expect(ruta).toMatch(/setSpeechLangPref\(user\.email, comisa\)/)
  })

  it('vocea folosește preferința detectată a contului; fără ea revine doar la engleză', () => {
    expect(ruta).toMatch(/let limbaPin = 'en-US'/)
    expect(ruta).toMatch(/const selected = selectVoiceLocale\(pref\)/)
    expect(ruta).not.toMatch(/if \(isAdminSession\) limbaPin = 'ro-RO'/)
    expect(ruta).not.toMatch(/user\.role === 'admin'/)
  })
})

describe('P20 — calea scrisă (chat.ts)', () => {
  it('gardul determinist de limbă există și pe scris, cu notă cinstită la suprimare', () => {
    expect(chat).toMatch(/limbaScrisaSuprimata = true/)
    expect(chat).toMatch(/replică scrisă suprimată \(începe în/)
    expect(chat).toMatch(/const NOTA_LIMBA = 'Mi-a scăpat începutul răspunsului în altă limbă/)
  })

  it('replica suprimată NU intră în istoric — se salvează nota, nu r.text-ul străin', () => {
    expect(chat).toMatch(/if \(limbaScrisaSuprimata\) assistantText = NOTA_LIMBA/)
  })

  it('ușa creierului nu mai dublează istoricul și nu mai scapă ture suprimate în el', () => {
    expect(chat).toMatch(/const eUsaCreierului = req\.body\?\.usaCreierului === true/)
    expect(chat).toMatch(/lastTurn\?\.role === 'user' && !eUsaCreierului/)
    expect(chat).toMatch(/if \(assistantText && !eUsaCreierului\) \{/)
  })

  it('sentinela <TAC/> se prinde și în variante („<tac/>", „<TAC />") — nu se mai emite și rostește', () => {
    expect(chat).toMatch(/\.toUpperCase\(\)\s*\n\s*if \(SENTINELA_TAC\.startsWith\(capat\)\)/)
    expect(chat).toMatch(/<\\s\*tac\\s\*\\\/\?\\s\*>/)
  })

  it('bula de eroare se și ROSTEȘTE, iar cozile audio sintetizate se varsă (voice.finish în catch)', () => {
    expect(chat).toMatch(/voice\.feed\(spoken\)\s*\n\s*await voice\.finish\(\)\.catch/)
  })
})

describe('P20 — instrucțiunea și memoria (services)', () => {
  it('preferința de limbă din instrucțiunea Realtime urmează pinul sesiunii', () => {
    const ro = construiesteInstructiune('Ești Kelion.', 'Ana', [], undefined, 'ro-RO')
    const en = construiesteInstructiune('You are Kelion.', 'Ana', [], undefined, 'en-US')
    expect(ro).toContain('Limba preferată a conversației este ro-RO')
    expect(en).toContain('Limba preferată a conversației este en-US')
    expect(en).not.toContain('EXCLUSIV în română')
  })

  it('istoricul recent rămâne context etichetat, iar limba este o regulă separată', () => {
    const text = construiesteInstructiune(
      'Ești Kelion.',
      'Ana',
      [{ role: 'assistant', content: 'Context păstrat din tura anterioară.' }],
      undefined,
      'ro-RO',
    )
    expect(text).toContain('Kelion: Context păstrat din tura anterioară.')
    expect(text).toContain('schimb-o numai la cererea explicită a persoanei')
  })

  it('memoria unificată sare replicile străine ale lui Kelion sub lacătul românesc (comportament)', () => {
    const db = [
      { role: 'user', content: 'Kelion, ce ora e?' },
      { role: 'assistant', content: 'Eu não sei o que dizer agora' },
      { role: 'assistant', content: 'Este ora 14:30, Adrian.' },
    ]
    const cuLacat = memorieUnificata(db, [], 12, true)
    expect(cuLacat).not.toContain('não')
    expect(cuLacat).toContain('ora 14:30')
    expect(cuLacat).toContain('Kelion, ce ora e?') // rândurile omului trec mereu
    // fără lacăt (user pe altă limbă) — nimic nu se filtrează
    const faraLacat = memorieUnificata(db, [], 12, false)
    expect(faraLacat).toContain('não')
  })
})

describe('P20 — frontend: banda și poarta half-duplex', () => {
  it('banda ACUMULEAZĂ deltele pe canale, cu etichetă, și se golește la închiderea turei', () => {
    expect(panou).toMatch(/onUser: \(text, final\) => \{[\s\S]{0,180}auzit = final \? '' : auzit \+ text[\s\S]{0,80}arataBanda\('auzit'\)/)
    expect(panou).toMatch(/onKelion: \(text, final\) => \{[\s\S]{0,180}spus = final \? '' : spus \+ text[\s\S]{0,80}arataBanda\('spus'\)/)
    expect(panou).toMatch(/onTuraInchisa: \(\) => \{[\s\S]{0,180}auzit = ''[\s\S]{0,80}spus = ''[\s\S]{0,80}setLiveVoice\(''\)/)
  })

  it('clientul anunță închiderea turei pe AMBELE drumuri (tura_gata + barge-in)', () => {
    const apeluri = clientVL.match(/opts\.onTuraInchisa\?\.\(\)/g) ?? []
    expect(apeluri.length).toBeGreaterThanOrEqual(2)
  })

  it('poarta half-duplex nu se mai zăvorăște pe context SUSPENDAT (mut și surd simultan)', () => {
    expect(clientVL).toMatch(/ctxOut\.state === 'running' &&\s*\n\s*\(surseActive\.length > 0/)
  })
})
