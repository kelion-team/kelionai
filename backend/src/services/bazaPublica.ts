import { config } from '../config.js'

// ── BAZA PUBLICĂ A LINKURILOR DE ECRAN (10 aug, ownerul: „nu poate afișa
// hărți") ────────────────────────────────────────────────────────────────────
// MĂSURAT: cadrele de monitor cu URL absolut se construiau din Host-ul
// cererii. Pe calea VOCALĂ, creierul e chemat INTERN (turaCreierului apelează
// ruta internă /api/chat cu Host = loopback:8080) → harta pleca spre browserul
// omului ca https://loopback:8080/api/route?… — browserul LUI
// încerca să ia harta de pe propriul calculator → nimic, întotdeauna. Pe chatul
// scris (Host = kelionai.app) mergea — de-aia bug-ul a trăit atât: se ascundea
// exact pe calea pe care o folosește ownerul (vocea).
// Regula: un Host de loopback/intern nu e NICIODATĂ baza linkurilor pentru
// browser — cade pe domeniul public.
export const BAZA_PUBLICA_IMPLICITA = config.publicOrigin

export function bazaPublica(host: string | undefined | null): string {
  const h = String(host ?? '').trim().toLowerCase()
  if (!h) return BAZA_PUBLICA_IMPLICITA
  const gazda = h.replace(/:\d+$/, '')
  const eInterna =
    gazda === 'localhost' ||
    gazda === '0.0.0.0' ||
    gazda === '[::1]' ||
    gazda === '::1' ||
    gazda.startsWith('127.') ||
    gazda.startsWith('10.') ||
    gazda.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(gazda)
  return eInterna ? BAZA_PUBLICA_IMPLICITA : `https://${h}`
}
