// ── TESTELE PAZNICULUI DE LIMBĂ (audit 30 iul: „bagă-le în teste pe toate") ──
//
// `lang.ts` decide ÎN CE LIMBĂ vorbește Kelion. Avea zero teste, deși a produs
// bug-uri reale, documentate în AI-HANDOFF:
//   • româna FĂRĂ diacritice („Buna ziua… multumesc") ieșea `null` → răspuns în
//     engleză, contra regulii „răspunde în limba primită";
//   • vorbirea românească auzită ca RUSĂ ar fi fixat „ru" pentru user și ar fi
//     otrăvit toate sesiunile — de aceea există setul de limbi suportate;
//   • comutarea limbii cere DOUĂ mesaje la rând în limba nouă, ca o
//     mis-detectare izolată să nu schimbe preferința.
// Testele astea le prind dacă revin.
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
    expect(langLabel('xx')).toBe('English') // limbă necunoscută → nu crapă
  })
})

describe('lang — detectarea limbii', () => {
  it('prinde româna CU diacritice', () => {
    expect(detectLang('Bună ziua, îți mulțumesc pentru ajutor')).toBe('ro')
  })
  it('prinde româna FĂRĂ diacritice (bugul din 26 iul)', () => {
    // Exact textul care ieșea `null` și primea răspuns în engleză.
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
    // Prima apariție a francezei: se reține ca „în așteptare", nu se comite.
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
