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
//   • listă:    „SARCINĂ LUATĂ SINGUR din RAMAS-DE-FACUT.md, rândul B8." + titlul
//   • ordinele directe ale ownerului: chiar textul lui, fără ambalaj.
// Funcție PURĂ, folosită la CITIRE de ambele afișaje (panoul admin + monitorul)
// — sursa (orderText) rămâne neatinsă, deci constructorul primește tot ordinul.

const scurt = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 110)

export function numeleOrdinului(brut: string): string {
  const text = String(brut ?? '')

  // 1) Fapta declarată explicit — cerințe și goluri (ghilimeaua e opțională).
  const ceACerut = /CE A CERUT(?: OMUL ȘI N-AI PUTUT FACE)?:\s*[„"]?([\s\S]{1,400}?)(?:["”]|\n\n|$)/.exec(text)
  if (ceACerut?.[1]?.trim()) return scurt(ceACerut[1])

  // 2) Rândul luat singur din lista ownerului — codul + titlul rândului.
  const rand = /SARCINĂ LUATĂ SINGUR din RAMAS-DE-FACUT\.md, rândul ([A-Z]\d+)\.\s*\n+([^\n]{1,300})/.exec(text)
  if (rand) return scurt(`${rand[1]}: ${rand[2]}`)

  // 3) Restul (ordinele directe ale ownerului, auto-vindecarea): prima linie de
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
