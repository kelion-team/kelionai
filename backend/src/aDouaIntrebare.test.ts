import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── A DOUA ÎNTREBARE NU SE MAI PIERDE ───────────────────────────────────────
//
// Adrian, 31 iul: „aude a doua întrebare, scurt o arată, dar nu o dă mai
// departe către creier, repară" — și, imediat: „mesajul că tehnic a apărut din
// nou". Cele două propoziții descriau ACELAȘI lanț:
//
//   1. Scrii ceva nou cât Kelion încă răspunde → tura veche e abortată
//      intenționat (barge-in, ChatPanel:823). Corect, așa e proiectat.
//   2. `lib/chat.ts` prindea abortul într-un `catch {}` fără discernământ și-l
//      scotea ca `Error('offline')` — o anulare cerută de om, raportată ca pană
//      de rețea.
//   3. `offline` pornește mecanismul de reluare: marchează sesiunea căzută și
//      reține textul. La următorul semnal `online`, ChatPanel:1588 face
//      `cur.slice(0, -2)` — ȘTERGE ULTIMELE DOUĂ MESAJE. După barge-in, alea
//      sunt fix întrebarea nouă și răspunsul ei în curs.
//   4. În paralel, `catch`-ul din ChatPanel scria `setMessages([...next, ...])`
//      cu instantaneul turei VECHI, fără garda `stillCurrent` — pe care
//      `finally`-ul de dedesubt o avea de mult. Asimetria aia era bug-ul.
//
// Frontendul n-are runner de teste; îl citim de aici, ca la poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const panou = sursa('../../frontend/src/components/ChatPanel.tsx')
const flux = sursa('../../frontend/src/lib/chat.ts')

describe('abortul nu mai e confundat cu o pană de rețea', () => {
  it('anularea cerută iese ca „aborted", nu ca „offline"', () => {
    expect(flux).toMatch(/throw new Error\('aborted'\)/)
  })

  it('ambele locuri care aruncau „offline" verifică întâi abortul', () => {
    // Erau DOUĂ: la deschiderea cererii și la citirea din flux. Una singură
    // reparată ar fi lăsat jumătate din bug în picioare.
    const gardieni = flux.match(/signal\?\.aborted \|\| \(e instanceof Error && e\.name === 'AbortError'\)/g) ?? []
    expect(gardieni.length).toBe(2)
  })

  it('mecanismul de reluare rămâne — dar numai pentru offline ADEVĂRAT', () => {
    // Ștergerea celor două mesaje e corectă când chiar ai pierdut semnalul.
    // Greșit era s-o declanșeze o anulare voită.
    expect(panou).toContain('cur.slice(0, -2)')
    expect(panou).toMatch(/if \(code === 'offline'\)/)
  })
})

describe('o tură înlocuită nu mai scrie peste tura nouă', () => {
  it('catch-ul verifică dacă a fost înlocuit, exact ca finally-ul', () => {
    expect(panou).toMatch(/const inlocuita = abortRef\.current !== ac/)
    expect(panou).toMatch(/if \(ac\.signal\.aborted \|\| codErr === 'aborted' \|\| inlocuita\)/)
  })

  it('mesajul de eroare se scrie funcțional, nu cu instantaneu', () => {
    // O scriere cu instantaneu (`setMessages([...next, …])`) rescrie lista cu
    // starea turei vechi și șterge orice a apărut între timp — exact ce făcea
    // dispărută întrebarea a doua.
    //
    // ATENȚIE la granița pe care o păzim: UNA singură e legitimă — cea de la
    // ÎNCEPUTUL turei (`content: ''`), care tocmai stabilește starea nouă și
    // n-are ce clobber-a. Toate celelalte, și în primul rând cea cu ⚠️ din
    // catch, trebuie să fie funcționale. De asta testul nu interzice tiparul
    // în bloc, ci exact scrierea de eroare.
    const instantanee = panou.match(/setMessages\(\[\.\.\.next,[\s\S]{0,120}?\]\)/g) ?? []
    expect(instantanee.length).toBe(1)
    expect(instantanee[0]).toContain("content: ''")
    expect(instantanee[0]).not.toContain('⚠️')
    // Iar eroarea chiar folosește updater-ul funcțional.
    expect(panou).toMatch(/setMessages\(\(cur\) => \{[\s\S]{0,500}⚠️/)
  })

  it('finally-ul își păstrează garda (n-am reparat unul stricând altul)', () => {
    expect(panou).toMatch(/const stillCurrent = abortRef\.current === ac/)
    expect(panou).toMatch(/if \(stillCurrent\) \{[\s\S]{0,160}setBusy\(false\)/)
  })
})

describe('barge-in-ul rămâne întreg', () => {
  // Regula lui Adrian din 13 iul: „când lucrează nu aude microfonul / nu-i
  // ajunge textul". Coada fusese scoasă anume ca a doua întrebare să plece
  // IMEDIAT. Reparația de azi nu are voie s-o readucă.
  it('input nou cât lucrează = tura veche tăiată, tura nouă pornită pe loc', () => {
    expect(panou).toMatch(/abortRef\.current\?\.abort\(\)[^\n]*superseded/)
    expect(panou).toMatch(/NU return — cădem mai jos și pornim tura nouă chiar acum/)
  })

  it('a doua întrebare chiar pleacă spre creier, cu ea în conversație', () => {
    expect(panou).toMatch(/const next: ChatMessage\[\] = \[\.\.\.messages, \{ role: 'user', content: outgoing/)
    expect(panou).toMatch(/for await \(const chunk of streamChat\(\s*\n?\s*next,/)
  })
})
