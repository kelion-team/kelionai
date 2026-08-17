// ── MEMORIA UNIFICATĂ voce↔scris (Adrian, 9 aug 2026) ───────────────────────
//
// Ownerul, cu captură (a scris „ai căutat? sau cauți?" iar Kelion a răspuns „Nu
// am efectuat nicio căutare", deși căutase în sesiunea vocală):
//     „trebuie să preia și din audio sau invers din scris istoricul, indiferent
//      modalitatea de a comunica cu el".
//
// MĂSURAT în cod: `/api/chat` construia contextul creierului DOAR din array-ul
// trimis de client (`req.body.messages`) — adică turele SCRISE de pe ecran. Cât
// timp sesiunea vocală live rula, transcrierile ei se salvau în DB (`messages`)
// dar NU intrau în array-ul clientului (onUser/onKelion doar afișau banda live).
// Deci creierul SCRIS era orb la ce se VORBISE. Invers mergea deja: calea vocală
// citește DB (`getRecentHistory`) la deschiderea sesiunii — orbirea era pe un
// singur sens.
//
// Funcția asta e PURĂ (se probează fără DB): din istoricul REAL din DB (care are
// AMBELE modalități) scoate rândurile care NU sunt deja în array-ul clientului
// (ca să nu dublăm turele scrise care apar oricum în transcript) și le coace
// într-un rând de context pentru systemPrompt — exact cum calea vocală coace
// „ULTIMELE VOASTRE SCHIMBURI". Ce rămâne sunt, în practică, turele VORBITE pe
// care scrisul nu le avea.

import { continuareStraina } from './limbaRaspuns.js'

export interface RandIstoric {
  role: string
  content: string
}

/** Normalizează pentru comparație/afișare: string sigur, tuns la 400 de caractere. */
const norm = (s: unknown): string => String(s ?? '').trim().slice(0, 400)

/**
 * Coace nota de MEMORIE UNIFICATĂ pentru creierul scris.
 *
 * @param dbRows   istoricul REAL din DB (ambele modalități), ordine oarecare
 * @param clientMessages  array-ul turei curente trimis de client (turele scrise)
 * @param cap      câte rânduri lipsă, cel mult, intră în notă (cele mai recente)
 * @returns nota gata de lipit la systemPrompt, sau '' dacă nu lipsește nimic
 */
export function memorieUnificata(
  dbRows: RandIstoric[],
  clientMessages: RandIstoric[],
  cap = 12,
  /** Lacătul românesc e activ (userLang=ro)? Atunci replicile lui Kelion
   *  detectate străine NU se re-injectează — calea vocală își filtrează exact
   *  așa istoricul (services/vocalLive.ts, „ISTORICUL NU CARĂ OTRAVA"), dar
   *  scrisul le prezenta cu framing-ul „ți-o amintești ca fiind a ta" și
   *  legitima limba străină (auditul 15 aug). Rândurile omului trec mereu. */
  limbaBlocataRo = false,
): string {
  if (!Array.isArray(dbRows) || dbRows.length === 0) return ''
  const inClient = new Set<string>()
  for (const m of Array.isArray(clientMessages) ? clientMessages : []) {
    const intreg = norm(m.content)
    if (intreg) inClient.add(`${m.role}:${intreg}`)
    // Turele LIPITE (sanitizeHistory din chat.ts unește turele consecutive de
    // același rol cu \n) se sparg pe linii: rândul din DB e o BUCATĂ a turei
    // lipite — pe cheia întreagă nu s-ar potrivi niciodată și ambele ture ar
    // reintra în prompt, dublate (audit 9 aug).
    for (const bucata of String(m.content ?? '').split('\n')) {
      const b = norm(bucata)
      if (b) inClient.add(`${m.role}:${b}`)
    }
  }
  // Rândurile din DB care NU-s deja în transcriptul clientului = ce n-a văzut
  // creierul scris (de regulă turele vorbite). Golurile fără conținut se sar;
  // sub lacătul românesc, replicile străine ale lui Kelion se sar și ele.
  const lipsa = dbRows.filter(
    (r) =>
      norm(r.content) &&
      !inClient.has(`${r.role}:${norm(r.content)}`) &&
      (!limbaBlocataRo || r.role === 'user' || !continuareStraina(String(r.content))),
  )
  if (lipsa.length === 0) return ''
  const randuri = lipsa
    .slice(-cap)
    .map((r) => `${r.role === 'user' ? 'Omul' : 'Kelion'}: ${norm(r.content)}`)
    .join('\n')
  return (
    `\n\nMEMORIA UNIFICATĂ (ce s-a VORBIT ȘI ce s-a SCRIS cu acest om, indiferent de ` +
    `modalitate — ți-o amintești ca fiind a ta; unele rânduri vin din sesiunea vocală și ` +
    `NU apar în transcriptul scris de mai jos, dar s-au întâmplat cu adevărat):\n${randuri}`
  )
}
