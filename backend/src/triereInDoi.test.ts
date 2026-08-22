import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hasActionIntent } from './services/brainContract'

// ── TRIEREA ÎN DOI (JARVIS pasul 3 — PROIECT-CHAT-VOCE §4, „inima") ─────────
// Cât creierul greu macină, ce spune omul (ADRESAT) devine informație pentru
// gândirea în curs; la întoarcerea ușii, creierul greu primește runde de
// convergență cu ce s-a aflat. STOP: nimic nou = răspunsul e gata (nu un
// procent inventat). Lacătele pinuiează COD VIU (lecția anti-M6).

// Ordinea filtrării CONTEAZĂ: întâi cad liniile „//", abia apoi blocurile
// „/* */" — altfel un „/*" dintr-un comentariu de linie (chat.ts are
// `/api/admin/*` într-unul) pornește un fals bloc care înghite mii de
// linii de COD VIU și lacătele pică pe cod care există.
const dezbraca = (sursa: string): string =>
  sursa
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
const viu = dezbraca(readFileSync(fileURLToPath(new URL('./routes/vocalLive.ts', import.meta.url)), 'utf8'))
const chatViu = dezbraca(readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8'))

describe('trierea în doi pe calea vocală', () => {
  it('rostirea ADRESATĂ sosită cât ușa grea macină intră în convergență (aceeași gardă ca la comenzi)', () => {
    expect(viu).toMatch(/^\s*let injectiiUsa: string\[\] = \[\]/m)
    expect(viu).toMatch(/^\s*if \(usiGreleInZbor > 0 && rostireCurenta\.trim\(\)\) \{\s*\n\s*injectiiUsa\.push\(rostireCurenta\.trim\(\)\)/m)
  })
  it('ușa pornește curată și convergența rulează doar pe informație NOUĂ, cu plafon (nu e raliu) și doar la PROPRIETARUL trierii', () => {
    expect(viu).toMatch(/^\s*injectiiUsa\.length = 0/m)
    expect(viu).toMatch(/^\s*while \(r\.ok && usaTrierii === usaId && injectiiUsa\.length > 0 && runde < RUNDE_TRIERE\) \{/m)
    expect(viu).toMatch(/\[TRIEREA ÎN DOI — ce a spus omul cât gândeai\]/)
    // proprietatea se eliberează pe ORICE drum (finally):
    expect(viu).toMatch(/usiGreleInZbor--\s*\n\s*if \(usaTrierii === usaId\) usaTrierii = 0/)
  })
  it('runda de convergență NU e amnezică și NU re-execută faptele (clasa interzisă B#2 — verificatorul a demonstrat emailul dublu)', () => {
    // runda 2 cară istoricul rundei 1 + instrucțiunea „doar DIFERENȚA":
    expect(viu).toMatch(/istoric: \[\s*\n\s*\{ role: 'user', content: cerere \},\s*\n\s*\{ role: 'assistant', content: r\.text \}/)
    expect(viu).toMatch(/NU repeta faptele deja făcute/)
    // turaCreierului declară continuarea:
    expect(viu).toMatch(/^\s*continuareUsa: triere \? true : undefined/m)
    // …iar chat.ts n-o mai tratează ca acțiune pe LINIA VIE — cereActiune-ul
    // care armează forteazaFapta/toolChoice='required', nu cel din fazaTurei
    // (verificatorul a dovedit că excepția pusă doar la fazaTurei era cod mort):
    expect(chatViu).toMatch(/^\s*const cereActiune = \(hasActionIntent\(lastUserText\) \|\| turnHasImage\) && req\.body\?\.continuareUsa !== true/m)
    // la FAZĂ (inventarul de unelte) ușa rămâne acțiune FĂRĂ excepție — runda
    // de continuare tot uneltele fazei grele trebuie să le vadă:
    expect(chatViu).toMatch(/^\s*cereActiune: hasActionIntent\(textulTurei\) \|\| req\.body\?\.usaCreierului === true,/m)
    // pe continuare, relatarea cinstită a faptei din runda 1 NU e „demascată"
    // cu verdict de fals — primește varianta „nu pot verifica" (Legea #1):
    expect(chatViu).toMatch(/continuareUsa === true \? textulNuPotVerifica\(nedovedite\) : textulDemascarii\(nedovedite\)/)
    // runda picată NU aruncă răspunsul bun deja obținut (regula #1):
    expect(viu).toMatch(/rămân pe ultimul răspuns bun/)
    expect(viu).toMatch(/if \(!r2\.ok\) \{[\s\S]{0,220}break/)
  })
  it('regexul de intenție se aprinde pe ÎNSUȘI șablonul rundei 2 („fă doar DIFERENȚA", „pune-o scurt") — de-asta excepția trebuie legată de continuareUsa, nu lăsată pe seama regexului', () => {
    // dovada pericolului, rulată pe chiar textul șablonului din vocalLive.ts:
    // fără garda continuareUsa, forțarea s-ar arma pe propriul nostru text de
    // sistem, nu pe vorbele omului (exact gaura găsită de verificator).
    expect(hasActionIntent('[TRIEREA ÎN DOI — ce a spus omul cât gândeai]: la ce oră e liber mâine?\nContinuă de unde ai rămas, ținând cont de TOT. NU repeta faptele deja făcute în runda de dinainte (email trimis, eveniment creat, orice unealtă cu efect) — fă doar DIFERENȚA nouă. Dacă o întrebare rămasă încă MUTĂ răspunsul, pune-o scurt și decent; altfel răspunde final.')).toBe(true)
  })
  it('protocolul e în fișa uneltei (declarat o dată la setup): întreabă întâi, completează, oprește-te la convergență, fără narațiune de proces', () => {
    expect(viu).toMatch(/TRIEREA ÎN DOI: dacă cererea e ambiguă/)
    expect(viu).toMatch(/nicio\s*'\s*\+\s*'întrebare rămasă nu mai mută răspunsul/)
  })
})
