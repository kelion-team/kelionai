// ── THE LANGUAGE GUARD'S TESTS (Jul 30 audit: "put them all into tests") ──
//
// `lang.ts` decides WHICH LANGUAGE Kelion speaks. It had zero tests, although
// it produced real bugs, documented in AI-HANDOFF:
//   • Romanian WITHOUT diacritics ("Buna ziua… multumesc") came out `null` →
//     an English answer, against the "reply in the received language" rule;
//   • Romanian speech heard as RUSSIAN would have pinned "ru" for the user
//     and poisoned all sessions — that's why the supported-languages set
//     exists;
//   • switching languages requires TWO messages in a row in the new language,
//     so an isolated mis-detection doesn't change the preference.
// These tests catch them if they come back.
import { describe, it, expect } from 'vitest'
import {
  primaryLang,
  langLabel,
  detectLang,
  detectSpeechLang,
  trackSpeechLang,
  checkLang,
} from './services/lang.js'

describe('lang — normalizarea codului de limbă', () => {
  it('taie regiunea din tag', () => {
    expect(primaryLang('ro-RO')).toBe('ro')
    expect(primaryLang('en_US')).toBe('en')
    expect(primaryLang('  fr  ')).toBe('fr')
  })
  it('întoarce null pe gunoi', () => {
    expect(primaryLang('')).toBeNull()
    expect(primaryLang(null)).toBeNull()
    expect(primaryLang('123')).toBeNull()
  })
  it('numele englezesc al limbii, cu engleza ca ultimă plasă', () => {
    expect(langLabel('ro-RO')).toBe('Romanian')
    expect(langLabel('de')).toBe('German')
    expect(langLabel(null)).toBe('English')
    expect(langLabel('xx')).toBe('English') // unknown language → doesn't crash
  })
})

describe('lang — detectarea limbii', () => {
  it('prinde româna CU diacritice', () => {
    expect(detectLang('Bună ziua, îți mulțumesc pentru ajutor')).toBe('ro')
  })
  it('prinde româna FĂRĂ diacritice (bugul din 26 iul)', () => {
    // The exact text that came out `null` and got an English answer.
    expect(detectLang('Buna ziua, multumesc frumos')).toBe('ro')
  })
  it('nu confundă limbile latine între ele', () => {
    expect(detectLang('Hola, gracias por todo, buenos días')).toBe('es')
    expect(detectLang('Bonjour, merci pour votre aide maintenant')).toBe('fr')
    expect(detectLang('Hello, thanks for your help this morning')).toBe('en')
  })
  it('la text scurt/ambiguu păstrează limba stabilită, nu ghicește', () => {
    expect(detectLang('ok', 'ro-RO')).toBe('ro')
    expect(detectLang('da', 'fr')).toBe('fr')
  })
  it('fără text și fără limbă anterioară → null (nu inventează)', () => {
    expect(detectLang('')).toBeNull()
    expect(detectLang('   ')).toBeNull()
  })
})

describe('lang — limba VORBIRII (BCP-47)', () => {
  it('scrierile non-latine se recunosc direct', () => {
    expect(detectSpeechLang('こんにちは、元気ですか')).toBe('ja-JP')
    expect(detectSpeechLang('안녕하세요 반갑습니다')).toBe('ko-KR')
    expect(detectSpeechLang('Привет, как дела')).toBe('ru-RU')
    expect(detectSpeechLang('Доброго дня, як справи ґ')).toBe('uk-UA')
  })
  it('româna devine ro-RO', () => {
    expect(detectSpeechLang('Bună seara, cum ești?')).toBe('ro-RO')
  })
})

describe('lang — comutarea limbii cere CONFIRMARE (două mesaje la rând)', () => {
  it('un singur mesaj în altă limbă NU schimbă preferința', () => {
    const email = `t1-${Date.now()}@x.y`
    // French's first appearance: it's kept as "pending", not committed.
    expect(trackSpeechLang(email, 'Bonjour, merci pour votre aide', 'ro-RO')).toBeNull()
  })
  it('aceeași limbă nouă de DOUĂ ori la rând → se comite', () => {
    const email = `t2-${Date.now()}@x.y`
    expect(trackSpeechLang(email, 'Bonjour, merci pour votre aide', 'ro-RO')).toBeNull()
    expect(trackSpeechLang(email, 'Bonjour, je suis ici maintenant', 'ro-RO')).toBe('fr-FR')
  })
  it('GARDA: o limbă NESUPORTATĂ nu se comite NICIODATĂ (româna auzită ca rusă)', () => {
    const email = `t3-${Date.now()}@x.y`
    expect(trackSpeechLang(email, 'Привет, как дела у тебя', 'ro-RO')).toBeNull()
    expect(trackSpeechLang(email, 'Привет, что нового сегодня', 'ro-RO')).toBeNull()
  })
  it('mesaj în limba deja stabilită → nicio schimbare', () => {
    const email = `t4-${Date.now()}@x.y`
    expect(trackSpeechLang(email, 'Bună ziua, mulțumesc mult', 'ro-RO')).toBeNull()
  })
})

describe('lang — verdictul asupra răspunsului produs', () => {
  it('răspuns în limba cerută → ok', () => {
    expect(checkLang('Bună, îți spun imediat rezultatul', 'ro-RO')).toEqual({ ok: true })
  })
  it('răspuns în ALTĂ limbă → prins, cu limba detectată', () => {
    const v = checkLang('Hello, I will tell you the answer now, thanks', 'ro-RO')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.detected).toBe('en')
  })
  it('fără limbă stabilită nu impune nimic', () => {
    expect(checkLang('orice text', null)).toEqual({ ok: true })
  })
})
