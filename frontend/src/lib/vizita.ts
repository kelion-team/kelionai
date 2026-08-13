// ── RAPORTAREA SECȚIUNII VIZITATE („ce au vizitat") — owner, 13 aug ──────────
// „dacă la raport nu am și ce au vizitat, nu mă ajută cu nimic." Fiecare pagină
// publică (acasă / credite / manual) anunță o dată pe sesiune ce secțiune a
// deschis vizitatorul; serverul le strânge DISTINCT pe același rând de vizită
// (dedup 6h), ca raportul din admin să arate nu doar CINE, ci și CE a deschis.
//
// O singură definiție a beaconului, ca poarta jscpd să nu vadă cod duplicat și
// ca eticheta secțiunii să fie consistentă peste tot. Fire-and-forget: analiza
// nu trebuie să strice niciodată pagina.

import { deviceFingerprint } from './fingerprint'

/** Anunță secțiunea curentă (o dată pe sesiune, per etichetă). Best-effort. */
export function raporteazaPagina(eticheta: string): void {
  const cheie = `kelion_vizita_${eticheta}`
  try {
    if (sessionStorage.getItem(cheie)) return
    sessionStorage.setItem(cheie, '1')
  } catch {
    /* fără sessionStorage (mod privat strict): raportăm oricum, serverul dedupe */
  }
  void deviceFingerprint()
    .then((fp) =>
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fp, ref: document.referrer, path: eticheta }),
      }),
    )
    .catch(() => {})
}
