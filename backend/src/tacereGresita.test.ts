import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { numeStrigat, turaAdresata } from './services/numeStrigat.js'

// ── „VORBESC ȘI NU SE ÎNTÂMPLĂ NIMIC" (8 aug 2026) ─────────────────────────
//
// Adrian a rulat măsurătoarea pe VPS-ul lui. Din jurnalul aplicației, de două
// ori la rând, pe două ture diferite:
//
//     [CHAT-IN] audio=da „"
//     [TIMP] tura 6654183f: creier=google-direct/gemini-3.5-flash-lite, runde=1, total=1619ms
//     [VOCE] tura 6654183f: creierul a decis că NU i se vorbea — tăcere
//
// Deci: fraza AJUNGE la creier (nu e microfonul), creierul RĂSPUNDE în 1,6s (nu
// e cheia — apelul direct la Gemini a ieșit 200 în 482 ms), și apoi decide
// singur că nu lui i se vorbea.
//
// DOUĂ CAUZE, amândouă reparate aici:
//
// 1. STRUCTURALĂ. `heavy` se calcula din TEXT, iar o tură de voce ambientală
//    n-are text deloc (fraza e audio brut, în alt câmp). Deci `heavy` ieșea
//    MEREU fals și cea mai consecventă decizie binară din aplicație — „mi se
//    vorbește mie sau nu" — cădea automat pe modelul cel mai ieftin. Nu era o
//    părere despre modele; era o poartă care nu se putea deschide.
//
// 2. INVIZIBILĂ. `<TAC/>` stingea tura fără nicio urmă. Un fals „nu mi se
//    vorbea" arăta EXACT ca zgomot de fond ignorat corect. Aceeași familie ca
//    „£0.00": ceva ce n-a mers, raportat ca tăcere.

const src = (p: string): string => fs.readFileSync(new URL(`./${p}`, import.meta.url), 'utf8')

describe('a fost strigat pe nume — funcție pură, probată pe rostiri reale', () => {
  it('strigat direct, în toate felurile în care îl aude un microfon', () => {
    for (const rostire of [
      'Kelion, cât e ceasul?',
      'kelion deschide camera',
      'Hei Kelion, ce faci',
      'ok Kelion arată-mi banii',
      'Kei, oprește-te',
      'Chelion cât costă',
      'KELION!',
      'kelian, vino',
      'Keliolon, buna',
      'keliolon ajuta-ma',
      'Kelly, bună dimineața!',
      'kelly ce faci',
      'K, cat e ceasul',
      'k deschide camera',
    ]) {
      expect(numeStrigat(rostire), `„${rostire}" e o strigare pe nume și n-a fost recunoscută`).toBe(true)
    }
  })

  it('NU e strigare: vorbire despre el, sau cuvinte care doar seamănă', () => {
    for (const rostire of [
      'am pierdut cheia de la mașină',
      'dă-mi cheile te rog',
      'nu știu ce să zic',
      'ok merem mai departe', // „ok" != „k" ca token izolat de adresare
      'mâine mergem la piață',
      // Numele apare, dar TÂRZIU: se vorbește DESPRE el, nu CĂTRE el.
      'ieri i-am povestit lui Andrei despre Kelion și i-a plăcut mult',
      '',
      '(neinteligibil)',
    ]) {
      expect(numeStrigat(rostire), `„${rostire}" NU e o strigare, dar a fost luată ca atare`).toBe(false)
    }
  })

  it('fără text, răspunsul e „nu" — nu se inventează nici într-o parte', () => {
    // „N-a spus ce-a auzit" NU înseamnă „a fost strigat", și nici invers.
    expect(numeStrigat('')).toBe(false)
    expect(numeStrigat('   ')).toBe(false)
  })
})

// ── GARDUL DETERMINIST AL SESIUNII LIVE — CONTRACTUL STRICT ─────────────────
// Istoria: pe 9 aug contractul era „numele la început SAU dialog în curs"
// (fereastra de 120s). Pe 15 aug ownerul a ordonat VERBATIM: „kelion trebuie
// sa raspunda doar cind aude numele, doar atunci" — „doar atunci" a revocat
// fereastra. FIECARE frază cere numele; fără nume = tăcere, oricât de proaspăt
// ar fi vorbit Kelion. Cine repune fereastra o face DOAR cu ordinul lui.
describe('turaAdresata — gardul serverului pe sesiunea live (STRICT, 15 aug)', () => {
  it('numele strigat deschide tura — singura cheie', () => {
    expect(turaAdresata('Kelion, cât e ceasul?')).toBe(true)
    expect(turaAdresata('hei Kelion ajută-mă')).toBe(true)
  })

  it('răspunsul la întrebarea LUI, fără nume → tot tăcere („doar atunci")', () => {
    // Pe 9 aug astea treceau prin fereastra de dialog; ordinul din 15 aug le-a
    // închis: fără nume nu răspunde nici la propria lui întrebare.
    expect(turaAdresata('da, te rog')).toBe(false)
    expect(turaAdresata('nu, mersi')).toBe(false)
  })

  it('vorbire între ALȚI oameni → suprimat, ca întotdeauna', () => {
    expect(turaAdresata('și i-am zis că vin mâine pe la ei')).toBe(false)
    expect(turaAdresata('No. Identifica errores y le da a la luz.')).toBe(false)
  })

  it('gol / neinteligibil → tăcere: un nume nemăsurat nu e un nume auzit', () => {
    expect(turaAdresata('')).toBe(false)
    expect(turaAdresata('   ')).toBe(false)
  })
})


describe('familie kelio* / combinații ASR (owner 17 aug)', () => {
  it('acceptă prefixe și combinații pe rădăcina numelui', () => {
    for (const rostire of [
      'kelio ajută',
      'kelios',
      'keliolon pornește',
      'Kelionn salutare',
      'kellion hey',
      'kelly dimineata',
    ]) {
      expect(numeStrigat(rostire), rostire).toBe(true)
    }
  })
  it('nu confunda cuvinte comune care doar conțin litere similare', () => {
    expect(numeStrigat('am pierdut cheia')).toBe(false)
    expect(numeStrigat('ok mergem')).toBe(false)
  })
})

describe('tura de voce ajunge pe modelul bun, iar tăcerea se explică', () => {
  const chat = src('routes/chat.ts')

  it('o tură de voce ambientală e „grea" — altfel decizia de trezire cade mereu pe modelul ieftin', () => {
    expect(
      /decideAdresarea/.test(chat),
      'clasificatorul judecă iar doar din text, iar tura de voce n-are text → flash-lite decide trezirea',
    ).toBe(true)
    const linie = /const heavy =[\s\S]{0,200}/.exec(chat)?.[0] ?? ''
    expect(/decideAdresarea/.test(linie), 'steagul există, dar nu intră în calculul lui `heavy`').toBe(true)
    expect(
      /selectedBrainModel\(user\.email, lastUserText, modelChoiceKv, turnHasImage, voceAmbianta\)/.test(chat),
      'steagul nu e trimis din tura reală — ar rămâne mort',
    ).toBe(true)
  })

  it('promptul cere să spună CE a auzit chiar și când tace', () => {
    const bloc = chat.slice(chat.indexOf('AMBIENT VOICE MODE'), chat.indexOf('AMBIENT VOICE MODE') + 2200)
    expect(/If NOT addressed[\s\S]{0,400}AUZIT/.test(bloc), 'tăcerea rămâne fără urmă, deci nediagnosticabilă').toBe(true)
  })

  it('parserul culege ce-a auzit din răspunsul tăcut, iar jurnalul numește tăcerea greșită', () => {
    expect(/const dupa = trimmed\.slice\(SENTINELA_TAC\.length\)/.test(chat), 'nu se citește nimic după <TAC/>').toBe(
      true,
    )
    expect(/TĂCERE GREȘITĂ/.test(chat), 'o tăcere peste un nume strigat arată la fel ca una corectă').toBe(true)
    expect(/numeStrigat\(userEcho\)/.test(chat), 'verdictul nu se calculează pe ce a auzit').toBe(true)
  })
})

// ── ÎNTÂRZIEREA PÂNĂ LA PRIMUL SUNET (Adrian, 8 aug) ────────────────────────
// „există o întârziere nejustificată de la întrebare la primul sunet".
// Cauza structurală: protocolul cerea creierului să scrie PRIMA linia
// „AUZIT: <tot ce ai spus>", iar poarta aștepta newline-ul ei (sau 240 de
// caractere) ca să lase ceva să iasă. Adică nimic nu se putea rosti până nu se
// termina de transcris ce-ai zis — o frază întreagă de așteptare, la fiecare
// tură, pentru un ecou care nu se rostește niciodată (e pentru ecran).

describe('primul sunet nu mai așteaptă o transcriere întreagă', () => {
  const chat = src('routes/chat.ts')

  it('promptul cere răspunsul ÎNTÂI, ecoul la sfârșit', () => {
    const bloc = chat.slice(chat.indexOf('AMBIENT VOICE MODE'), chat.indexOf('AMBIENT VOICE MODE') + 2800)
    expect(/START YOUR SPOKEN REPLY IMMEDIATELY/.test(bloc), 'creierul scrie iar ecoul primul').toBe(true)
    expect(/it must come LAST/.test(bloc)).toBe(true)
  })

  it('poarta NU mai așteaptă newline-ul sau 240 de caractere', () => {
    expect(
      /trimmed\.length < 240/.test(chat),
      'a rămas așteptarea de 240 de caractere — exact întârzierea reclamată',
    ).toBe(false)
    expect(
      /Așteptăm prima linie/.test(chat),
      'a rămas așteptarea liniei AUZIT înainte de a lăsa vocea să iasă',
    ).toBe(false)
  })

  it('ecoul de la sfârșit e reținut, nu rostit — și coada nu se pierde', () => {
    expect(/coadaEcou/.test(chat), 'ecoul final ar fi rostit în gura mare').toBe(true)
    expect(/potrivirePartiala/.test(chat), 'fără potrivire parțială, marcajul tăiat între pachete ar scăpa').toBe(true)
    // Dacă marcajul nu vine deloc, coada e text normal și TREBUIE scrisă.
    expect(/if \(coadaEcou\) \{/.test(chat), 'coada reținută s-ar pierde tăcut la sfârșit de tură').toBe(true)
  })
})
