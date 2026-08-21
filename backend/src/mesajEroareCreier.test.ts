import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── USERUL PLĂTITOR NU VEDE NICIODATĂ MODELE / PLAFOANE / BANI ─────────────
//
// Adrian, Aug 1: "mesajul asta nu trebuie sa apara nici o data la useri
// platitori" + "userul free plateste la aplicatie, prin credite […] lui
// trebuie sa functioneze permanent fara mesaje de genul acela".
//
// REGULA (adaptată la Gemini-only, 3 aug — extirparea totală OpenRouter):
// erorile creierului (429, răspuns gol, model căzut) se absorb prin
// REÎNCERCĂRI pe ACELAȘI creier Gemini. Userul aude un mesaj NEUTRU
// ("încearcă din nou") ABIA dacă toate încercările pică. Detaliile tehnice
// rămân doar în logul serverului. NU mai există rotire pe alt furnizor.
//
// Testul citește codul REAL. Dacă cineva repune un mesaj despre modele /
// plafon / bani în calea vizibilă userului, cade aici.
const sursa = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('reîncercările tăcute pe creierul Gemini (fără alt furnizor)', () => {
  it('un model gol sau picat NU închide turul din prima — se reîncearcă', () => {
    expect(sursa).toMatch(/reîncercare/)
    expect(sursa).toMatch(/brain_gemini_exhausted/)
  })

  it('textul parțial ajuns la user oprește reîncercarea (nu dublăm răspunsul)', () => {
    expect(sursa).toMatch(/if \(textFlowed\) throw ge/)
  })

  it('nu mai există pool/catalog de alt furnizor pe calea creierului', () => {
    expect(sursa).not.toMatch(/getCatalog|listaCandidati|classifyCost|blendedPerM/)
  })
})

describe('mesajele vizibile userului sunt neutre', () => {
  it('NU există mesaje user-facing despre modele gratuite sau plafoane', () => {
    expect(sursa).not.toContain('Modelul gratuit a atins plafonul')
    expect(sursa).not.toContain('free model hit its per-minute')
  })

  it('NU există mesaje user-facing despre „creier gol" sau instrucțiuni de model/Setări', () => {
    expect(sursa).not.toContain('creierul a răspuns gol')
    expect(sursa).not.toContain('the brain returned empty')
    expect(sursa).not.toContain('schimbă modelul din Setări')
    expect(sursa).not.toContain('switch the model in Settings')
  })

  it('NU există mesaje user-facing care cer bani sau menționează creditul creierului', () => {
    expect(sursa).not.toContain('Am epuizat momentan creditul creierului')
    expect(sursa).not.toContain('run out of brain credit')
    expect(sursa).not.toContain('nu e o problemă de bani')
    expect(sursa).not.toContain('not a money problem')
  })

  it('mesajul neutru există în ambele limbi', () => {
    expect(sursa).toContain('Încearcă din nou în câteva secunde.')
    expect(sursa).toContain('Try again in a few seconds.')
  })

  it('clasificarea 429/402/refusal rămâne DOAR pentru log', () => {
    expect(sursa).toMatch(/console\.error\('\[CHAT ERROR\]'[\s\S]{0,120}isRateLimit/)
  })

  it('eroarea NE-tranzitorie nu mai promite fals că „din nou în câteva secunde" ajută (registrul backend #4) — mesajul rămâne neutru, dar onest', () => {
    // cazul măsurat: modelul pensionat (not found) a tăcut zile întregi cu
    // „încearcă din nou". Ancorat ÎN clasificator (CE-2 al verificatorului:
    // un /not.?found/ pe tot fișierul se hrănea din promptul youtube — vacuu).
    // Forma `not[_ ]found`, NU `not.?found` — aceea prindea și ENOTFOUND
    // (pană DNS tranzitorie) și mințea cu „reformuleaz-o" (F5a).
    expect(sursa).toMatch(/const eNetranzitorie =[\s\S]{0,500}not\[_ \]found/)
    expect(sursa).toContain('Cererea asta nu a putut fi dusă la capăt')
    expect(sursa).toContain('This request could not be completed')
  })

  it('fapta deja executată în tura moartă se SPUNE omului — fără detalii tehnice (registrul #2, partea omului)', () => {
    expect(sursa).toMatch(/const fapteDejaExecutate = doveziUnelte\.some\(/)
    expect(sursa).toMatch(/eUnealtaCuEfectExtern\(d\.nume\)/)
    expect(sursa).toContain('Am apucat să execut o parte din ce ai cerut înainte de întrerupere')
    expect(sursa).toContain('Part of what you asked was already carried out before the interruption')
  })
})

// ── EROAREA NU SE ÎNGHITE TĂCUT PE CĂILE FURNIZORULUI (registrul backend #5+#6) ──
// Verificatorul lotului B a cerut lacăte și pentru astea două — altfel pot
// regresa MUT, exact clasa de tăcere pe care lotul B o vindecă.
const gemini = readFileSync(fileURLToPath(new URL('./services/geminiDirect.ts', import.meta.url)), 'utf8')
const asr = readFileSync(fileURLToPath(new URL('./services/asr.ts', import.meta.url)), 'utf8')

describe('erorile furnizorului nu se înghit tăcut', () => {
  it('evenimentul {error} din stream-ul SSE Gemini se ARUNCĂ numit, nu se ignoră (registrul #5)', () => {
    expect(gemini).toMatch(/let eroareStream: GResp\['error'\] \| undefined/)
    expect(gemini).toMatch(/if \(ev\.error && !eroareStream\) eroareStream = ev\.error/)
    expect(gemini).toMatch(/if \(eroareStream\) \{\s*throw new Error\(/)
  })
  it('căderea Chirp ASR se scrie în jurnal ÎNAINTE de fallback-ul pe urechea Gemini, pe ambele căi (registrul #6)', () => {
    const urme = asr.match(/\[ASR CHIRP CĂZUT\]/g) ?? []
    expect(urme.length).toBeGreaterThanOrEqual(2)
    // urma precede fallback-ul, nu îl înlocuiește
    expect(asr).toMatch(/\[ASR CHIRP CĂZUT\][\s\S]{0,200}transcribeFallbackGemini\(audio, opts\)/)
  })
})
