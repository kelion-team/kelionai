// ── GESTIUNEA CERINȚELOR + EVALUAREA SOLUȚIILOR ──────────────────────────────
//
// Adrian, 30 iul: „am nevoie de sisteme avansate alocate lui Kelion de gestiune
// a cerințelor, evaluări avansate pe soluțiile oferite" · „analiza și
// îmbunătățirea continuă a posibilităților de implementare / rezolvare a
// cerințelor".
//
// DE CE E NEVOIE, măsurat din ziua de azi, nu din teorie: o cerință de-a lui
// trăia în trei locuri care nu se vorbeau — un rând scris de mână în
// `RAMAS-DE-FACUT.md`, un ordin în `build_jobs` fără legătură cu cerința, și
// uneori doar în chat, de unde se pierdea. De-aia „ți-am cerut de zeci de ori"
// era ADEVĂRAT și nedemonstrabil în același timp. Și de-aia s-a apucat cineva
// (eu) să construiască pe prima idee care i-a venit, fără să pună alături
// variantele — emailul, portalul, API-ul — și fiecare a căzut pe rând.
//
// Aici cerința are UN drum, cu trei porți:
//   1. ANALIZA — înainte să se scrie o linie de cod, se pun pe masă 2-4 variante
//      REALE, fiecare cu scor pe cinci axe și cu ce o poate omorî. Se alege una,
//      cu motiv scris. O variantă care depinde de owner e marcată ca atare.
//   2. EXECUȚIA — ordinul pleacă cu varianta aleasă și cu criteriul de acceptare
//      lipit de el, ca ținta să nu se mute după ce s-a livrat ceva.
//   3. ÎMBUNĂTĂȚIREA CONTINUĂ — ce e livrat se reia periodic: „se putea mai
//      bine, acum, cu ce știm în plus?" Dacă da, iese o cerință nouă, legată de
//      prima. Fără asta, sistemul livrează o dată și îngheață.
import { brainComplete } from './brain.js'
import { adaugaCerinta, listeazaCerinte, actualizeazaCerinta, type Cerinta } from '../db.js'

/** O variantă de rezolvare, așa cum o pune pe masă. */
export interface Varianta {
  nume: string
  cum: string
  /** 0-10: cât de COMPLET rezolvă cerința (nu cât de elegant e). */
  rezolva: number
  /** 0-10: cât de repede se poate livra (10 = azi). */
  rapid: number
  /** 0-10: cât de puțin riscă să strice ce merge deja (10 = zero risc). */
  sigur: number
  /** 0-10: cât de puțin costă, în bani și în timpul ownerului (10 = gratis). */
  ieftin: number
  /** 0-10: cât de puțin depinde de owner sau de terți (10 = deloc). */
  independent: number
  /** Ce o poate omorî. Scris ONEST — o variantă fără riscuri e o variantă
   *  neanalizată. */
  risc: string
}

/** Scorul final. Ponderile spun ce contează în proiectul ĂSTA, în ordinea în
 *  care le-a spus ownerul de-a lungul zilei: să REZOLVE (altfel n-are rost), să
 *  nu-i mai ceară LUI timp (a pierdut o zi prin portaluri), să nu strice ce
 *  merge, să fie repede, să nu coste. */
export function scor(v: Varianta): number {
  const n = (x: number): number => Math.max(0, Math.min(10, Number(x) || 0))
  return (
    n(v.rezolva) * 0.35 +
    n(v.independent) * 0.25 +
    n(v.sigur) * 0.18 +
    n(v.rapid) * 0.12 +
    n(v.ieftin) * 0.1
  )
}

/** Cea mai bună variantă + de ce. Pură, deci se poate ține sub test: alegerea
 *  NU are voie să depindă de dispoziția modelului. */
export function alege(variante: Varianta[]): { castigatoare: Varianta; motiv: string } | null {
  if (!variante.length) return null
  const cu = variante.map((v) => ({ v, s: scor(v) })).sort((a, b) => b.s - a.s)
  const c = cu[0]
  const alDoilea = cu[1]
  const motiv = alDoilea
    ? `„${c.v.nume}" (scor ${c.s.toFixed(1)}) bate „${alDoilea.v.nume}" (${alDoilea.s.toFixed(1)}): ` +
      `rezolvă ${c.v.rezolva}/10 și depinde de owner cât mai puțin (${c.v.independent}/10). Risc: ${c.v.risc}`
    : `singura variantă pusă pe masă: „${c.v.nume}". Risc: ${c.v.risc}`
  return { castigatoare: c.v, motiv }
}

const AXE =
  `rezolva (cât de COMPLET rezolvă cerința), rapid (cât de repede se livrează), ` +
  `sigur (cât de puțin riscă să strice ce merge), ieftin (bani + timpul ownerului), ` +
  `independent (cât de puțin depinde de owner sau de terți)`

/** ANALIZA: pune pe masă variantele, le dă scoruri, alege una. */
export async function evalueazaCerinta(c: Cerinta): Promise<{ ok: boolean; detaliu: string }> {
  const prompt =
    `Ești Kelion și îți evaluezi SINGUR soluțiile, înainte să scrii o linie de cod.\n\n` +
    `CERINȚA OWNERULUI: "${c.text}"\n` +
    (c.criteriu ? `CUM SE DOVEDEȘTE CĂ E FĂCUTĂ: ${c.criteriu}\n` : '') +
    `\nPune pe masă 2-4 variante REALE de rezolvare. Nu variații ale aceleiași idei — ` +
    `drumuri diferite. Pentru fiecare dă note de la 0 la 10 pe axele: ${AXE}. ` +
    `Și scrie RISCUL — ce o poate omorî. O variantă fără riscuri e o variantă neanalizată.\n\n` +
    `LECȚIA ZILEI DE 30 IUL, ține cont de ea: o soluție care cere ownerului să umble ` +
    `prin portaluri sau conturi noi e o soluție PROASTĂ, chiar dacă tehnic e curată — ` +
    `de-aia „independent" cântărește mult.\n\n` +
    `Răspunde DOAR cu JSON valid: ` +
    `[{"nume":"...","cum":"în 1-2 propoziții, concret","rezolva":0,"rapid":0,"sigur":0,` +
    `"ieftin":0,"independent":0,"risc":"..."}] — fără alt text.`

  const raw = await brainComplete(prompt, 1600)
  if (!raw) return { ok: false, detaliu: 'creierul n-a răspuns' }
  let variante: Varianta[] = []
  try {
    const m = raw.match(/\[[\s\S]*\]/)
    variante = JSON.parse(m ? m[0] : raw) as Varianta[]
  } catch {
    return { ok: false, detaliu: 'răspuns care nu e JSON' }
  }
  const ales = alege(variante.filter((v) => v && typeof v.nume === 'string'))
  if (!ales) return { ok: false, detaliu: 'n-a pus nicio variantă pe masă' }

  await actualizeazaCerinta(c.id, {
    stare: 'analizata',
    optiuni: JSON.stringify(variante).slice(0, 8000),
    aleasa: `${ales.castigatoare.nume} — ${ales.castigatoare.cum}\nDE CE: ${ales.motiv}`.slice(0, 2000),
  })
  return { ok: true, detaliu: `${variante.length} variante evaluate → ${ales.castigatoare.nume}` }
}

/** ÎMBUNĂTĂȚIREA CONTINUĂ: ce e livrat se reia — „se putea mai bine, ACUM?"
 *
 *  Nu e cosmetică: o soluție bună acum șase săptămâni poate fi cea proastă azi,
 *  fiindcă între timp au apărut unelte noi (browserul, secretele) sau s-a
 *  închis un drum (API-ul care nu există pentru contul lui). Dacă iese ceva,
 *  devine o cerință NOUĂ, legată de prima — nu o rescriere tăcută a istoriei. */
export async function imbunatatireContinua(limita = 5): Promise<{ propuneri: number; detaliu: string }> {
  const livrate = (await listeazaCerinte('verificata', 50)).slice(0, limita)
  if (!livrate.length) return { propuneri: 0, detaliu: 'nimic livrat încă de reanalizat' }

  const lista = livrate.map((c) => `#${c.id}: "${c.text}" — rezolvat prin: ${c.aleasa ?? '(nescris)'}`).join('\n')
  const prompt =
    `Ești Kelion și îți reanalizezi SINGUR soluțiile deja livrate.\n\n` +
    `Pentru fiecare, întreabă-te: cu ce știi ACUM și cu uneltele pe care le ai ACUM, ` +
    `se putea mai bine? „Mai bine" înseamnă: rezolvă mai complet, cere mai puțin de la ` +
    `owner, sau riscă mai puțin. NU propune rescrieri de dragul eleganței — dacă merge ` +
    `bine, spui că merge bine.\n\n` +
    `LIVRATE:\n${lista}\n\n` +
    `Răspunde DOAR cu JSON: [{"id":<număr>,"mai_bine":true|false,"propunere":"<ce anume, ` +
    `într-o propoziție>","de_ce":"<ce s-a schimbat de atunci>"}] — fără alt text.`

  const raw = await brainComplete(prompt, 1400)
  if (!raw) return { propuneri: 0, detaliu: 'creierul n-a răspuns' }
  let d: { id?: number; mai_bine?: boolean; propunere?: string; de_ce?: string }[] = []
  try {
    const m = raw.match(/\[[\s\S]*\]/)
    d = JSON.parse(m ? m[0] : raw) as typeof d
  } catch {
    return { propuneri: 0, detaliu: 'răspuns care nu e JSON' }
  }
  const valide = new Set(livrate.map((c) => c.id))
  let n = 0
  for (const x of d) {
    if (!x.mai_bine || !x.propunere || !valide.has(Number(x.id))) continue
    const id = await adaugaCerinta(
      `ÎMBUNĂTĂȚIRE la cerința #${x.id}: ${String(x.propunere).slice(0, 500)}`,
      'kelion',
      `Se compară cu soluția de acum. Motivul reanalizei: ${String(x.de_ce ?? '').slice(0, 300)}`,
    )
    if (id) n++
  }
  return { propuneri: n, detaliu: n ? `${n} îmbunătățiri propuse de el` : 'a considerat că merg bine așa' }
}
