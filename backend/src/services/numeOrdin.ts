// ── NUMELE ORDINULUI = FAPTA, NU AMBALAJUL (P8) ─────────────────────────────
// (owner, 15 aug, cu #306 în față: „trebuie sa arate numele cu ce face
// ordinul... nu apare sugestiv ce face, trebuie sa fie foarte clar ce executa")
//
// MĂSURAT: rândul din coadă arăta primele caractere ale PROMPTULUI — adică
// ambalajul („NIVEL DE DIFICULTATE: 3/5 CERINȚA OWNERULUI #34. Ai analizat-o
// deja și ai ALES un drum — …"), niciodată fapta. Fapta stă mai jos, după
// marcaje fixe, în fiecare șablon de ordin:
//   • cerințe:  „CE A CERUT: <textul cerinței>"
//   • goluri:   „CE A CERUT OMUL ȘI N-AI PUTUT FACE: \"<textul>\""
//   • ordinele directe ale ownerului: chiar textul lui, fără ambalaj.
// Funcție PURĂ, folosită la CITIRE de ambele afișaje (panoul admin + monitorul)
// — sursa (orderText) rămâne neatinsă, deci constructorul primește tot ordinul.

const scurt = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 110)

export function numeleOrdinului(brut: string): string {
  const text = String(brut ?? '')

  // 1) Fapta declarată explicit — cerințe și goluri (ghilimeaua e opțională).
  const ceACerut = /CE A CERUT(?: OMUL ȘI N-AI PUTUT FACE)?:\s*[„"]?([\s\S]{1,400}?)(?:["”]|\n\n|$)/.exec(text)
  if (ceACerut?.[1]?.trim()) return scurt(ceACerut[1])

  // 2) Restul (ordinele directe ale ownerului): prima linie de
  // CONȚINUT, după curățarea ambalajului cunoscut (dificultate, pinul de
  // reluare, escaladarea). Ambalajul se curăță pe rând — ce rămâne e fapta.
  const curat = text
    .replace(/^NIVEL DE DIFICULTATE: \d\/5\s*/,'')
    .replace(/^⚠ AI ÎNCERCAT DEJA[\s\S]*?(?:\n\n|$)/, '')
    .replace(/^CERINȚA OWNERULUI #\d+\.[^\n]*\n+/, '')
    .replace(/^CAPABILITATE CARE ÎȚI LIPSEȘTE[^\n]*\n+/, '')
    .trim()
  const primaLinie = curat.split('\n').find((l) => l.trim()) ?? ''
  return scurt(primaLinie)
}

// ── CINE A CERUT ORDINUL (16 aug 05:47 — ownerul, cu #330 „Lucrează" în față:
// „aici nu esti tu" / „cine e acolo?") ───────────────────────────────────────
// Un ordin fără autor vizibil arată ca o fantomă: ownerul nu putea deosebi
// propriile ordine de cele născute de buclele automate. Funcție PURĂ: din
// ordered_by iese eticheta pe românește, pe care cardul o poartă la vedere.
export function cineACerut(orderedBy: string): string {
  const cine = String(orderedBy ?? '').toLowerCase().trim()
  if (!cine) return 'necunoscut'
  if (cine.includes('@')) return `👤 ${cine.split('@')[0]}`
  return cine
}
