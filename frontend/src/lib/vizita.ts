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

// ── POZA VIZITEI (P3; owner, 15 aug: „de ce nu e legata de vizitator poza") ──
// Se trimite UN cadru mic pe sesiune, ABIA după ce omul a acordat camera —
// consimțământul cerut de ordinul din 13 aug („cine va fi acolo va avea o poză
// cu acceptul lor"). Boții nu pornesc camera, deci rămân cinstit fără poză.
// Best-effort: analiza nu are voie să strice nici camera, nici pagina.

/** Cadru JPEG mic (lățime ~160px) din elementul video viu, sau null. */
function cadruMic(video: HTMLVideoElement): string | null {
  try {
    if (!video.videoWidth || !video.videoHeight) return null
    const latime = 160
    const inaltime = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * latime))
    const panza = document.createElement('canvas')
    panza.width = latime
    panza.height = inaltime
    const ctx = panza.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, latime, inaltime)
    return panza.toDataURL('image/jpeg', 0.7)
  } catch {
    return null // canvas „tainted" sau video mort — fără poză, nu fără cameră
  }
}

/** Anunță poza vizitei (o dată pe sesiune). Chemată după pornirea camerei. */
export function raporteazaPozaVizitei(video: HTMLVideoElement | null): void {
  if (!video) return
  const cheie = 'kelion_vizita_poza'
  try {
    if (sessionStorage.getItem(cheie)) return
  } catch {
    /* mod privat strict — serverul oricum păstrează doar prima poză a vizitei */
  }
  const poza = cadruMic(video)
  if (!poza || poza.length > 200_000) return
  try {
    sessionStorage.setItem(cheie, '1')
  } catch {
    /* fără sessionStorage: prima-poză-rămâne de pe server ne apără de dubluri */
  }
  void deviceFingerprint()
    .then((fp) =>
      fetch('/api/visit/poza', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fp, poza }),
      }),
    )
    .catch(() => {})
}
