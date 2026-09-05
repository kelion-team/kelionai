// Contractele acțiunilor explicite din chat rămân valabile după retragerea
// meniului Aplicații. Nicio intrare sau comandă de meniu nu este recreată aici.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hasActionIntent } from './services/brainContract.js'
import { UNELTE_VORBIRE } from './services/fazeChat.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const chat = sursa('./routes/chat.ts')

describe('P28 — RUPTURA #4: granițele regex pe diacritice (bugul „Fă-mi")', () => {
  it('„Fă-mi" e ACȚIUNE (vechiul \\bf[ăa]\\b nu-l prindea niciodată — ă rupe \\b)', () => {
    expect(hasActionIntent('Fă-mi un document Google nou.')).toBe(true)
    expect(hasActionIntent('Fă-mi un tabel Google nou.')).toBe(true)
    expect(hasActionIntent('fă ordine pe monitor')).toBe(true)
  })

  it('„arată" fără „-mi" e acțiune; „urcă" (YouTube upload) e acțiune', () => {
    expect(hasActionIntent('arată ce am în calendar')).toBe(true)
    expect(hasActionIntent('Urcă un clip de-al meu pe YouTube')).toBe(true)
  })

  it('cuvintele care doar CONȚIN literele nu declanșează (fals-pozitivele stau afară)', () => {
    expect(hasActionIntent('e o fărâmă de adevăr')).toBe(false)
    expect(hasActionIntent('ce mai faci?')).toBe(false)
  })
})

describe('P28 — RUPTURA #2: open_app_view acceptă tot ce promite propria schemă', () => {
  it('lista executorului conține cv (schema îl promitea, serverul îl refuza)', () => {
    expect(chat).toMatch(/\['settings', 'wallet', 'contact', 'admin', 'trading', 'home', 'cv'\]/)
  })

  it('schema și executorul au ACEEAȘI listă de views (nu mai pot diverge tăcut)', () => {
    const defs = sursa('./services/brainToolDefs.ts')
    const dinSchema = defs.match(/enum: \['settings', 'wallet', 'contact', 'admin', 'trading', 'home', 'cv'\]/)
    expect(dinSchema).not.toBeNull()
  })
})

describe('P28 — RUPTURA #5: prețurile au o SURSĂ (lista_tarife), nu se inventează', () => {
  it('unealta lista_tarife există, citește meniul viu și spune calitatea activă', () => {
    expect(chat).toMatch(/name: 'lista_tarife'/)
    expect(chat).toMatch(/case 'lista_tarife': \{/)
    expect(chat).toMatch(/meniulDeTarife\(\)\.map/)
    expect(chat).toMatch(/video_activ: cheiaTarifGenerareVideo\(\)/)
  })

  it('e în ambele liste de unelte și e permisă pe faza de vorbire (prețul e conversație)', () => {
    expect((chat.match(/TARIFE_TOOL/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(UNELTE_VORBIRE).toContain('lista_tarife')
  })
})

describe('P28 — RUPTURA #7: verdictele seci au primit cauza', () => {
  it('search_unavailable spune dacă lipsește cheia sau a picat cota/rețeaua', () => {
    const google = sursa('./services/google.ts')
    expect(google).toMatch(/cheia SERPER_KEY lipsește din configurare — fără ea nu există căutare web/)
    expect(google).toMatch(/cheia SERPER_KEY lipsește din configurare — fără ea nu există căutare video/)
    expect(google).toMatch(/serviciul de hărți \(OpenStreetMap\/Nominatim, gratuit\) a răspuns/)
  })
})
