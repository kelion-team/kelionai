import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE SECOND QUESTION IS NO LONGER LOST ──────────────────────────────────
//
// Adrian, Jul 31: "it hears the second question, shows it briefly, but doesn't
// pass it on to the brain, fix it" — and immediately: "the message that
// technically appeared again". The two sentences described the SAME chain:
//
//   1. You type something new while Kelion is still answering → the old turn
//      is aborted on purpose (barge-in, ChatPanel:823). Correct, that's the
//      design.
//   2. `lib/chat.ts` caught the abort in an indiscriminate `catch {}` and
//      emitted it as `Error('offline')` — a human-requested cancellation,
//      reported as a network outage.
//   3. `offline` starts the resume mechanism: it marks the session as dropped
//      and keeps the text. On the next `online` signal, ChatPanel:1588 does
//      `cur.slice(0, -2)` — DELETES THE LAST TWO MESSAGES. After a barge-in,
//      those are exactly the new question and its in-flight answer.
//   4. In parallel, the ChatPanel `catch` wrote `setMessages([...next, ...])`
//      with the OLD turn's snapshot, without the `stillCurrent` guard — which
//      the `finally` below had had for a long time. That asymmetry was the bug.
//
// The frontend has no test runner; we read it from here, like poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const panou = sursa('../../frontend/src/components/ChatPanel.tsx')
const flux = sursa('../../frontend/src/lib/chat.ts')

describe('abortul nu mai e confundat cu o pană de rețea', () => {
  it('anularea cerută iese ca „aborted", nu ca „offline"', () => {
    expect(flux).toMatch(/throw new Error\('aborted'\)/)
  })

  it('ambele locuri care aruncau „offline" verifică întâi abortul', () => {
    // There were TWO: at the request's opening and at reading from the
    // stream. Fixing only one would have left half the bug standing.
    const gardieni = flux.match(/signal\?\.aborted \|\| \(e instanceof Error && e\.name === 'AbortError'\)/g) ?? []
    expect(gardieni.length).toBe(2)
  })

  it('mecanismul de reluare rămâne — dar numai pentru offline ADEVĂRAT, cu ștergere ȚINTITĂ', () => {
    // Lot C (registrul frontend): slice(0,-2) ștergea ORB ultimele două bule —
    // dacă între cădere și revenire intrau altele (transcript vocal, altă
    // întrebare), le rupea pe alea. Acum: exact bula de eroare (ts reținut) +
    // ULTIMA bulă user cu textul reluat.
    expect(panou).not.toContain('cur.slice(0, -2)')
    expect(panou).toMatch(/retryEroareTsRef\.current = tsEroare/)
    // ambele bule pe TS (nu pe conținut — turele cu documente diferă), ambele coduri
    expect(panou).toMatch(/retryUserTsRef\.current = userTs/)
    expect(panou).toMatch(/mm\.role === 'assistant' && tsEroare !== null && mm\.ts === tsEroare/)
    expect(panou).toMatch(/mm\.role === 'user' && tsUser !== null && mm\.ts === tsUser/)
    expect(panou).toMatch(/if \(code === 'offline'\)/)
  })
})

describe('o tură înlocuită nu mai scrie peste tura nouă', () => {
  it('catch-ul verifică dacă a fost înlocuit, exact ca finally-ul', () => {
    expect(panou).toMatch(/const inlocuita = abortRef\.current !== ac/)
    expect(panou).toMatch(/if \(ac\.signal\.aborted \|\| codErr === 'aborted' \|\| inlocuita\)/)
  })

  it('mesajul de eroare se scrie funcțional, nu cu instantaneu', () => {
    // A snapshot write (`setMessages([...next, …])`) rewrites the list with
    // the old turn's state and erases anything that appeared in the meantime —
    // exactly what made the second question disappear.
    //
    // ATTENTION to the boundary we guard: only ONE is legitimate — the one at
    // the START of the turn (`content: ''`), which establishes the new state
    // and has nothing to clobber. All the others, first of all the ⚠️ one in
    // the catch, must be functional. That's why the test doesn't forbid the
    // pattern wholesale, but exactly the error write.
    const instantanee = panou.match(/setMessages\(\[[\s\S]{0,140}?\]\)/g) ?? []
    expect(instantanee.length).toBe(1)
    expect(instantanee[0]).toContain("content: ''")
    expect(instantanee[0]).not.toContain('⚠️')
    // And the error really uses the functional updater.
    expect(panou).toMatch(/setMessages\(\(cur\) => \{[\s\S]{0,500}⚠️/)
  })

  it('finally-ul își păstrează garda (n-am reparat unul stricând altul)', () => {
    expect(panou).toMatch(/const stillCurrent = abortRef\.current === ac/)
    expect(panou).toMatch(/if \(stillCurrent\) \{[\s\S]{0,160}setBusy\(false\)/)
  })
})

describe('barge-in-ul rămâne întreg', () => {
  // Adrian's rule from Jul 13: "while it works it doesn't hear the
  // microphone / the text doesn't reach it". The queue had been removed
  // precisely so the second question leaves IMMEDIATELY. Today's fix is not
  // allowed to bring it back.
  it('input nou cât lucrează = tura veche tăiată, tura nouă pornită pe loc', () => {
    expect(panou).toMatch(/if \(busyRef\.current \|\| inFlightRef\.current\) \{[\s\S]{0,240}interruptAll\('barge-in-text'\)[\s\S]{0,120}abortRef\.current\?\.abort\(\)/)
    expect(panou).toMatch(/NO return — we fall through below and start the new turn right now/)
  })

  it('a doua întrebare chiar pleacă spre creier, cu ea în conversație', () => {
    expect(panou).toMatch(/const conversationBase = online\s*\? messages\s*: combinaIstoricLocal\(messages, await istoricOfflineLocal\(\)\)/)
    expect(panou).toMatch(/const next: ChatMessage\[\] = \[\s*\.\.\.conversationBase,\s*\{ role: 'user', content: outgoing, ts: userTs \}/)
    // Creierul (calea ONLINE) primește tot `next` (conversația cu întrebarea nouă).
    // De la faza 1 offline, apelul e într-un ternar (online = streamChat, offline =
    // creier local), iar fluxul se consumă prin `sursaFlux` — dar `next` ajunge la
    // creier neschimbat, deci a doua întrebare tot pleacă.
    expect(panou).toMatch(/streamChat\(\s*\n?\s*next,/)
    expect(panou).toMatch(/for await \(const chunk of sursaFlux\)/)
  })
})
