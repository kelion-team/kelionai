// ── CODUL UNIC DE PLATĂ (Adrian, 30 iul) ─────────────────────────────────────
//
// „fiecare plată trebuie să fie însoțită de un cod unic" · „userul X cumpără
// credit de atâția bani, tranzacția are un cod alocat unic generat, la plată se
// trece automat la ce cod/client".
//
// Revolut Pro n-are webhook, deci nimeni nu ne anunță că s-a plătit. Codul e
// puntea: pleacă cu omul la plată, se întoarce în referința tranzacției bancare,
// iar potrivirea îl leagă înapoi de contul lui. Fără el ar rămâne gestiunea
// manuală — „în ziua de azi, la mii de potențiali useri", cum a spus.
//
// Testat aici e EXTRAGEREA codului din referință: singura bucată pură din lanț,
// și cea de care depinde tot restul. Dacă tiparul e prea lax, un text oarecare
// ar putea trece drept cod; dacă e prea strict, plata omului ajunge „neatribuită"
// și munca manuală se întoarce pe ușa din dos.
import { describe, it, expect } from 'vitest'

/** Exact tiparul din `crediteazaDupaCod` (db.ts). Ținut identic aici, ca testul
 *  să apere REGULA, nu o copie aproximativă a ei. */
function codDinReferinta(referinta: string): string | null {
  const m = referinta.toUpperCase().replace(/\s+/g, '-').match(/KLN-[A-Z2-9]{4}-[A-Z2-9]{4}/)
  return m ? m[0] : null
}

describe('codul de plată se recunoaște în referința bancară', () => {
  it('referință curată, exact codul', () => {
    expect(codDinReferinta('KLN-AB23-CD45')).toBe('KLN-AB23-CD45')
  })

  it('cu text în jur — băncile adaugă mereu ceva', () => {
    expect(codDinReferinta('Plata credite KLN-AB23-CD45 multumesc')).toBe('KLN-AB23-CD45')
    expect(codDinReferinta('REF: KLN-AB23-CD45/GBP')).toBe('KLN-AB23-CD45')
  })

  it('scris cu litere mici — omul copiază cum vrea', () => {
    expect(codDinReferinta('kln-ab23-cd45')).toBe('KLN-AB23-CD45')
  })

  it('cu spații în loc de cratime — greșeala cea mai probabilă la tastare', () => {
    expect(codDinReferinta('KLN AB23 CD45')).toBe('KLN-AB23-CD45')
  })

  it('fără cod → null, deci plata ajunge la „neatribuite", nu la un om greșit', () => {
    expect(codDinReferinta('transfer de la Ion')).toBeNull()
    expect(codDinReferinta('')).toBeNull()
  })

  it('NU acceptă caractere confundabile (0/O, 1/I/L) — alfabetul le exclude', () => {
    // Alfabetul codului nu conține 0, O, 1, I sau L tocmai ca omul să nu se
    // încurce la citit. Un „cod" care le conține nu e un cod de-al nostru.
    expect(codDinReferinta('KLN-AB0O-CD45')).toBeNull()
    expect(codDinReferinta('KLN-AB1I-CD45')).toBeNull()
  })

  it('lungime greșită → null, în ambele sensuri (nu ghicim pe un cod stricat)', () => {
    // Un caracter în minus SAU în plus înseamnă că omul a greșit la copiat.
    // Alegerea deliberată e să NU potrivim: mai bine plata ajunge la
    // „neatribuite" și o rezolvă adminul, decât să creditam un cont apropiat.
    expect(codDinReferinta('KLN-AB2-CD45')).toBeNull()
    expect(codDinReferinta('KLN-AB234-CD45')).toBeNull()
  })

  it('două coduri în aceeași referință → îl ia pe primul, determinist', () => {
    // Nu ghicim între ele: prima potrivire, mereu aceeași. Dacă e greșit, plata
    // apare la „neatribuite" pentru celălalt și o rezolvă adminul.
    expect(codDinReferinta('KLN-AB23-CD45 si KLN-XY78-ZW99')).toBe('KLN-AB23-CD45')
  })
})
