import { config } from '../config.js'
import { brainComplete } from './brain.js'
import { repoOpenPR } from './github.js'
import { resurseGazda, PRAG_INCARCARE_PCT } from './resurse.js'
import { LUCRATORI, ruleazaLucrator, lucratoriInstalati, type Propunere } from './lucratori.js'

// ── PANOUL: TREI PROPUN, CREIERUL ALEGE ─────────────────────────────────────
//
// Adrian, 31 iul: „trebuie pornite toate 3, fiecare independent, creierul ia
// care e cel mai bun rezultat propus de ei, după ce analizează propunerile".
//
// Exact asta face fișierul ăsta:
//   1. verifică dacă mașina duce (producția are prioritate — mereu)
//   2. vede CINE e instalat; lipsa unuia nu oprește panoul, se spune și se
//      merge mai departe cu ceilalți
//   3. pornește toți lucrătorii instalați ÎN PARALEL, pe aceeași sarcină, cu
//      MODELE DIFERITE — altfel n-ar fi trei păreri, ar fi aceeași părere de
//      trei ori
//   4. adună propunerile: diff măsurat cu git, teste rulate de noi
//   5. dă creierului propunerile și îl pune să ALEAGĂ, cu motiv
//   6. deschide UN SINGUR PR, pentru câștigător. Niciodată merge.
//
// DE CE MODELE DIFERITE: valoarea unui panou stă în diversitate. Trei unelte
// pe același model dau, de cele mai multe ori, aceeași soluție cu alte cuvinte.
// Fiecare lucrător primește alt creier gratuit, deci trei drumuri de gândire.
//
// DE CE CREIERUL ALEGE, ȘI NU O FORMULĂ: „cel mai bun" nu e „cel mai puțin
// cod" și nici „cel mai rapid". O propunere de 5 rânduri care repară cauza bate
// una de 200 care ascunde simptomul. Asta cere judecată, nu aritmetică. Dar
// judecata primește FAPTE ca intrare: câte fișiere, câte rânduri, TRECE sau NU
// testele — măsurate, nu declarate de unelte despre ele însele.

/** Câți lucrători pot rula odată. Trei clone + trei modele + trei rulări de
 *  teste e deja mult pe o mașină care ține și producția. */
const MAX_PARALEL = 3

/** Un singur panou odată. Al doilea primește un „nu" clar, nu o coadă tăcută. */
let ocupat = false

export interface RezultatPanou {
  ok: boolean
  motiv?: string
  /** Cine a fost pornit, cine lipsea. */
  pornit: string[]
  lipsa: string[]
  propuneri: Propunere[]
  /** Numele lucrătorului ales, dacă s-a ales unul. */
  castigator?: string
  /** De ce a fost ales — în cuvintele creierului. */
  judecata?: string
  pr?: string
}

/** Modele DIFERITE pentru lucrători diferiți — de asta e panou, nu ecou.
 *  Toate gratuite; ordinea e cea a capacității măsurate pe 31 iul. */
const MODELE = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'cohere/north-mini-code:free',
  'inclusionai/ling-3.0-flash:free',
]

/** Rezumatul unei propuneri, pentru creier. Numai fapte, în ordinea în care
 *  contează la judecată. */
function rezuma(p: Propunere, i: number): string {
  const cap = `### Propunerea ${i + 1} — ${p.lucrator} (model: ${p.model})`
  if (!p.ok) return `${cap}\nA EȘUAT: ${p.motiv ?? 'motiv necunoscut'}`
  if (!p.aSchimbat) return `${cap}\nN-a modificat nimic (${p.motiv ?? ''}).`
  const teste =
    p.testeTrec === null ? 'NU S-AU PUTUT RULA' : p.testeTrec ? 'TREC' : 'PICĂ'
  return (
    `${cap}\n` +
    `Fișiere atinse: ${p.fisiere} · +${p.adaugate} / −${p.sterse} rânduri · ${p.secunde}s\n` +
    `TESTELE PROIECTULUI: ${teste}\n` +
    `Ramura: ${p.branch}\n\n` +
    `\`\`\`diff\n${p.diff}\n\`\`\``
  )
}

/**
 * Pornește panoul pe o sarcină. Întoarce propunerile, judecata și PR-ul.
 * `raporteaza` primește pașii pe măsură ce se întâmplă (pentru monitor).
 */
export async function ruleazaPanou(
  sarcina: string,
  raporteaza?: (pas: string) => void,
): Promise<RezultatPanou> {
  const spune = (s: string): void => {
    raporteaza?.(s)
  }
  const gol: RezultatPanou = { ok: false, pornit: [], lipsa: [], propuneri: [] }

  const text = sarcina.trim()
  if (text.length < 10) return { ...gol, motiv: 'sarcina e prea scurtă ca să însemne ceva' }
  if (ocupat) return { ...gol, motiv: 'rulează deja un panou — unul singur odată' }
  if (!config.githubToken) return { ...gol, motiv: 'lipsește GITHUB_TOKEN — lucrătorii nu pot clona' }

  // ── PRODUCȚIA ARE PRIORITATE ─────────────────────────────────────────────
  // Trei lucrători în paralel înseamnă trei clone, trei modele și trei rulări
  // de teste pe mașina care ține și aplicația. Dacă e deja încărcată, panoul
  // NU pornește — o reparație nu merită o pagină care se mișcă greu.
  const res = await resurseGazda()
  if (res && res.incarcarePct >= PRAG_INCARCARE_PCT) {
    return { ...gol, motiv: `VPS-ul e încărcat ${res.incarcarePct}% — nu pornesc panoul acum, ar călca producția` }
  }
  if (res && res.liberGb < 2) {
    return { ...gol, motiv: `au mai rămas ${res.liberGb.toFixed(1)} GB liberi — prea puțin pentru trei lucrători` }
  }

  ocupat = true
  try {
    const instalati = await lucratoriInstalati()
    const echipa = LUCRATORI.filter((l) => instalati.includes(l.nume)).slice(0, MAX_PARALEL)
    const lipsa = LUCRATORI.filter((l) => !instalati.includes(l.nume)).map((l) => l.nume)
    if (!echipa.length) {
      return { ...gol, lipsa, motiv: `niciun lucrător instalat (lipsesc: ${lipsa.join(', ')})` }
    }
    spune(`Pornesc ${echipa.length} lucrători în paralel: ${echipa.map((l) => l.nume).join(', ')}` +
      (lipsa.length ? ` (lipsesc: ${lipsa.join(', ')})` : ''))

    // TOȚI ODATĂ, independent. `allSettled`: unul care crapă nu-i oprește pe
    // ceilalți — de-asta sunt trei.
    const rezultate = await Promise.allSettled(
      echipa.map((l, i) => ruleazaLucrator(l, MODELE[i % MODELE.length], text)),
    )
    const propuneri: Propunere[] = rezultate.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            lucrator: echipa[i].nume, model: MODELE[i % MODELE.length], ok: false,
            motiv: String(r.reason).slice(0, 200), aSchimbat: false,
            fisiere: 0, adaugate: 0, sterse: 0, diff: '', testeTrec: null, secunde: 0, log: '',
          },
    )
    for (const p of propuneri) {
      spune(`${p.lucrator}: ${p.aSchimbat ? `${p.fisiere} fișiere, teste ${p.testeTrec ? 'TREC' : p.testeTrec === null ? 'nerulate' : 'PICĂ'}` : (p.motiv ?? 'nimic')}`)
    }

    const valide = propuneri.filter((p) => p.ok && p.aSchimbat)
    if (!valide.length) {
      return { ok: true, pornit: echipa.map((l) => l.nume), lipsa, propuneri, motiv: 'niciun lucrător n-a produs o modificare' }
    }

    // ── JUDECATA ───────────────────────────────────────────────────────────
    // Un singur apel de creier, cu FAPTELE în față. Nu-i cerem să ghicească
    // dacă merge — îi spunem noi, măsurat, și-l punem să cântărească.
    spune(`Creierul compară ${valide.length} propuneri…`)
    const intrebare =
      `Ai ${valide.length} propuneri INDEPENDENTE pentru aceeași sarcină. Alege UNA.\n\n` +
      `SARCINA CERUTĂ DE OWNER:\n> ${text}\n\n` +
      valide.map(rezuma).join('\n\n') +
      `\n\n---\nCUM ALEGI, în ordinea asta:\n` +
      `1. O propunere care PICĂ testele nu se alege decât dacă toate pică.\n` +
      `2. Rezolvă CAUZA cerută, nu simptomul, și nu face altceva pe lângă.\n` +
      `3. Mai puțin cod care face treaba bate mai mult cod. Dar 5 rânduri care\n` +
      `   repară cauza bat 200 care ascund simptomul — nu număra, judecă.\n` +
      `4. Nu șterge cod fără motiv. O propunere care taie mult și explică puțin\n` +
      `   e suspectă (pe 31 iul un fișier de 1049 de rânduri a ajuns la 14 așa).\n\n` +
      `Răspunde EXACT în formatul:\n` +
      `ALEG: <numele lucrătorului>\n` +
      `MOTIV: <2-4 propoziții, concret, cu ce anume din diff te-a convins>`

    const verdict = await brainComplete(intrebare, 700).catch(() => '')
    const numeAles = /ALEG:\s*([a-z0-9_-]+)/i.exec(verdict)?.[1]?.toLowerCase() ?? ''
    const motivAles = /MOTIV:\s*([\s\S]+)/i.exec(verdict)?.[1]?.trim() ?? ''

    // Dacă creierul n-a răspuns în format (sau deloc), NU inventăm un
    // câștigător tăcut: cădem pe o regulă scrisă, și SPUNEM că am căzut pe ea.
    let castigator = valide.find((p) => p.lucrator.toLowerCase() === numeAles)
    let judecata = motivAles
    if (!castigator) {
      castigator = valide.find((p) => p.testeTrec) ?? valide[0]
      judecata =
        `(Creierul n-a dat un verdict în format — am ales după regula scrisă: ` +
        `prima propunere cu testele verzi.)${verdict ? `\n\nCe a răspuns: ${verdict.slice(0, 300)}` : ''}`
    }
    spune(`Ales: ${castigator.lucrator}`)

    const pr = await repoOpenPR(
      castigator.branch ?? '',
      `Panou: ${text.slice(0, 60)}`,
      `Sarcină dată de owner prin Kelion:\n\n> ${text}\n\n` +
        `## Cum s-a ales\n\n${judecata}\n\n` +
        `## Toate propunerile\n\n` +
        propuneri
          .map((p) =>
            `- **${p.lucrator}** (${p.model}) — ` +
            (p.ok && p.aSchimbat
              ? `${p.fisiere} fișiere, +${p.adaugate}/−${p.sterse}, teste ${p.testeTrec === null ? 'nerulate' : p.testeTrec ? '✅' : '❌'}, ${p.secunde}s` +
                (p.lucrator === castigator?.lucrator ? '  ← **ALES**' : ` (ramura \`${p.branch}\`)`)
              : `nu a propus nimic: ${p.motiv ?? '—'}`),
          )
          .join('\n') +
        `\n\n**Nu s-a făcut merge — te uiți tu.**`,
    ).catch((e: Error) => `PR nedeschis: ${e.message}`)

    return {
      ok: true,
      pornit: echipa.map((l) => l.nume),
      lipsa,
      propuneri,
      castigator: castigator.lucrator,
      judecata,
      pr,
    }
  } catch (e) {
    return { ...gol, motiv: e instanceof Error ? e.message : String(e) }
  } finally {
    ocupat = false
  }
}
