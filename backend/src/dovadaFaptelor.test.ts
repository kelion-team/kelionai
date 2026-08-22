import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rezumaStareFinalaSarcinaOperationala } from './services/jurnalOperational'

// ── SALVAREA = DOVADA pe voce (JARVIS pasul 4 — PROIECT-CHAT-VOCE §7) ────────
// Cercetașul a măsurat: jurnalul operațional era WRITE-ONLY (zero cititori),
// iar dovezile turei vocale ușoare mureau la golirea doveziVoceTura — „asul
// din mânecă" nu exista nici ca dată, nici ca unealtă. Lacătele de mai jos
// pinuiează COD VIU (lecția anti-M6, cu ordinea corectă a dezbrăcării:
// întâi liniile „//", abia apoi blocurile „/* */" — altfel un „/*" dintr-un
// comentariu de linie înghite mii de linii de cod viu).

const dezbraca = (sursa: string): string =>
  sursa
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
const citeste = (cale: string): string =>
  dezbraca(readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8'))

const db = citeste('./db.ts')
const adminTools = citeste('./services/adminTools.ts')
const toolDefs = citeste('./services/brainToolDefs.ts')
const vocal = citeste('./routes/vocalLive.ts')
const chat = citeste('./routes/chat.ts')

describe('dovada faptelor — cititorul jurnalului operațional (asul din mânecă)', () => {
  it('citirea există, e per-utilizator și o citire picată se SPUNE (Legea #1), nu se maschează în listă goală', () => {
    expect(db).toMatch(/export async function dovezileFaptelor\(/)
    expect(db).toMatch(/if \(!dbEnabled\(\)\) return \{ citit: false, motiv: 'baza de date nu e pornită' \}/)
    expect(db).toMatch(/WHERE user_email=\$1/)
    expect(db).toMatch(/return \{ citit: false, motiv: String\(e\)\.slice\(0, 200\) \}/)
  })
  it('unealta dovada_faptelor e legată: user-scoped, cu eroarea onestă și nota pe listă goală', () => {
    expect(adminTools).toMatch(/'cauta_istoric', 'dovada_faptelor', 'forget_memory'/)
    expect(adminTools).toMatch(/case 'dovada_faptelor': \{/)
    expect(adminTools).toMatch(/jurnal_operational_necitit/)
    expect(adminTools).toMatch(/Nicio faptă ÎNREGISTRATĂ/)
    // definiția e în inventarul unic (creierul o VEDE) și interzice recitarea pe voce:
    expect(toolDefs).toMatch(/name: 'dovada_faptelor'/)
    expect(toolDefs).toMatch(/LOG_GAP_TOOL, DOVADA_FAPTELOR_TOOL,/)
    expect(toolDefs).toMatch(/NEVER read the raw record aloud/)
  })
  it('pe voce, asul e la UN PAS: dovada_faptelor e în setul sesiunii Live (fără să macine ușa)', () => {
    expect(vocal).toMatch(/UNELTE_LIVE = new Set\(\[[^\]]*'dovada_faptelor'/)
  })
})

describe('tura vocală cu unelte lasă dovadă durabilă (jurnalul operațional)', () => {
  it('sarcina se creează LENEȘ (doar când chiar rulează o unealtă) și trece prin stările permise', () => {
    expect(vocal).toMatch(/^\s*if \(!sarcinaVoceId\) \{/m)
    expect(vocal).toMatch(/inregistreazaSarcinaOperationala\(\{\s*\n\s*id,\s*\n\s*userEmail: user\.email/)
    expect(vocal).toMatch(/tranzitieVoce\(id, 'interpreting', 'voice_tool_call'\)/)
    expect(vocal).toMatch(/tranzitieVoce\(id, 'executing', 'voice_tool_call'\)/)
  })
  it('fiecare rezultat clasificat devine eveniment; scrierile sunt fire-and-forget înlănțuite (zero latență pe frază, ordine păstrată) și respingerile {ok:false} nu mor tăcut', () => {
    expect(vocal).toMatch(/kind: 'tool_result',\s*\n\s*capability: dovada\.nume,\s*\n\s*outcomeState: dovada\.stare/)
    expect(vocal).toMatch(/lantJurnalVoce = lantJurnalVoce\s*\n\s*\.then\(scriere\)\s*\n\s*\.catch/)
    expect(vocal).toMatch(/if \(!r\.ok\) app\.log\.warn\(`\[jurnal operațional\]\[voce\] tranziție respinsă/)
  })
  it('sarcina are registrul EI de dovezi (gaura 1 a verificatorului: carry-over-ul cățelului nu contaminează verdictul altei ture) — aceeași regulă de derivare ca pe scris', () => {
    // ambele registre se umplu în același loc, dar trăiesc separat:
    expect(vocal).toMatch(/doveziVoceTura\.push\(dovada\)\s*\n\s*const taskId = sarcinaVoceaPentruFapta\(\)\s*\n\s*doveziSarcinaVoce\.push\(dovada\)/)
    // detașare EAGER la închidere (lanțul leneș nu numără push-uri de după):
    expect(vocal).toMatch(/const dovezi = doveziSarcinaVoce\s*\n\s*doveziSarcinaVoce = \[\]\s*\n\s*const cate = dovezi\.length/)
    expect(vocal).toMatch(/rezumaStareFinalaSarcinaOperationala\(\{ cereActiune: false, dovezi, planFaraExecutie: false \}\)/)
    // regula derivării (funcția pură): succes tehnic fără verificare = unverified, NU completed:
    expect(rezumaStareFinalaSarcinaOperationala({
      cereActiune: false,
      dovezi: [{ nume: 'send_email', stare: 'succeeded' }],
      planFaraExecutie: false,
    })).toEqual({ stare: 'unverified', cod: 'independent_verification_missing' })
  })
  it('nicio sarcină eternă pe executing (gaura 2): închiderea rulează pe TOATE drumurile care încheie tura — salvată, suprimată sau la close/error', () => {
    const inchideri = vocal.match(/^\s*inchideSarcinaVoce\(\)/gm) ?? []
    expect(inchideri.length).toBeGreaterThanOrEqual(5)
    // drumul rezidual (re-verificatorul): rezultatul uneltei sosit DUPĂ
    // închiderea socketului nu lasă o sarcină nou-deschisă pe veci:
    expect(vocal).toMatch(/^\s*if \(inchis\) inchideSarcinaVoce\(\)/m)
  })
})

describe('originea vocală și nota porții devin durabile în chat.ts', () => {
  it('sarcina ușii poartă marcajul usaCreierului/continuareUsa în metadate (dovada poate spune „asta ai cerut-o vorbind")', () => {
    expect(chat).toMatch(/usaCreierului: eUsaCreierului,\s*\n\s*continuareUsa: req\.body\?\.continuareUsa === true,/)
  })
  it('demascarea porții faptelor se scrie ca eveniment facts_gate (pe ușă, saveMessage e sărit — altfel nota murea în inelul de log)', () => {
    expect(chat).toMatch(/kind: 'facts_gate',\s*\n\s*outcomeState: 'observed',\s*\n\s*code: req\.body\?\.continuareUsa === true \? 'claims_unverifiable' : 'claims_without_deed',\s*\n\s*reason: nedovedite\.join\('; '\),/)
  })
})
