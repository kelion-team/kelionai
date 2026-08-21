// ── RUTAREA CHATULUI: mesaj → creier → răspuns, ÎNTOTDEAUNA ────────────────
//
// Adrian, Aug 2: a cerut o localizare în scris → „Am preluat sarcina" → apoi
// NIMIC. Părea că mesajul a fost înghițit de constructor. Dovada live din
// jurnalul serverului: `[tool] lookup_address (admin)` — cererea AJUNSERA la
// creier și unealta corectă chiar rulase; apoi textul final a venit GOL și
// tura s-a închis, pentru că ack-ul instant („Am preluat sarcina. ") fusese
// numărat drept „ceva vizibil" de interceptorul de scriere:
//
//   • rotirea silențioasă accepta răspunsul gol (`|| sawVisible`) — pe turile
//     fără ack (useri obișnuiți) rotirea funcționa: `[CHAT MUTE] ... returned
//     empty — silent rotation`;
//   • plasa anti-tăcere de la final nu mai pornea (același flag otrăvit).
//
// Regula corectă, păzită de testele de aici:
//   1. ack-ul instant este o CHITANȚĂ, nu un răspuns — nu contează ca vizibil;
//   2. orice tură preluată produce un răspuns real sau un mesaj onest;
//   3. constructorul primește sarcini DOAR la ordin explicit de construcție /
//      reparație de la admin (sau din panoul Admin → Constructor) — niciodată
//      un mesaj normal de chat;
//   4. vocea și scrisul ajung în ACELAȘI punct (POST /api/chat) — ruta de voce
//      nu are creier propriu.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { areCevaDeVazut, conteazaCaVizibil } from './services/chatFrames.js'
import { hasActionIntent } from './services/brainContract.js'

const CTRL = String.fromCharCode(31)
const cadru = (o: unknown): string => `${CTRL}${JSON.stringify(o)}${CTRL}`
const sursaChat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const sursaRealtime = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')
const sursaDefs = readFileSync(fileURLToPath(new URL('./services/brainToolDefs.ts', import.meta.url)), 'utf8')

describe('ack-ul instant NU e răspunsul (cauza exactă a „am preluat sarcina" + gol)', () => {
  it('„Am preluat sarcina." / „Task taken on." NU marchează tura ca vizibilă', () => {
    expect(conteazaCaVizibil('Am preluat sarcina. ', true)).toBe(false)
    expect(conteazaCaVizibil('Task taken on. ', true)).toBe(false)
  })

  it('textul real al creierului rămâne vizibil (regula nu taie răspunsuri)', () => {
    expect(conteazaCaVizibil('Ești la 2 km de centru, pe strada X.', false)).toBe(true)
  })

  it('o suprafață împinsă de o unealtă (harta) rămâne vizibilă — tura cu hartă fără text NU e mută', () => {
    expect(conteazaCaVizibil(cadru({ monitor: { url: 'https://x', title: 'Hartă' } }), false)).toBe(true)
  })

  it('ack-ul rămâne, prin natura lui, un text vizibil pentru om — de aceea filtrarea se face la SCRIERE, nu în areCevaDeVazut', () => {
    // Dacă cineva mută filtrarea ack-ului în areCevaDeVazut, tura mută reală
    // (fără ack) și cea cu ack s-ar confunda. Aici fixăm comportamentul brut:
    expect(areCevaDeVazut('Am preluat sarcina. ')).toBe(true)
    expect(conteazaCaVizibil('Am preluat sarcina. ', true)).toBe(false)
  })

  it('interceptorul de vizibilitate rămâne (ack-ul „Am preluat sarcina" scos — Adrian, 5 aug)', () => {
    // Ack-ul instant „Am preluat sarcina" a fost ELIMINAT la cererea lui Adrian
    // (5 aug: „scoate-i «am preluat sarcina»"). Infrastructura de vizibilitate
    // (conteazaCaVizibil în interceptor) rămâne — un răspuns gol tot nu poate fi
    // acceptat ca „văzut".
    expect(sursaChat).toMatch(/let ackInstantZbor = false/)
    expect(sursaChat).toMatch(/sawVisible = conteazaCaVizibil\(chunk, ackInstantZbor\)/)
  })

  it('reîncercarea NU mai poate accepta un răspuns gol doar pentru că a ieșit ack-ul', () => {
    // Condiția de acceptare există în continuare (text / text curgat / suprafață
    // pusă de unelte) — dar sawVisible nu mai poate fi otrăvit de ack (testele
    // de mai sus). Dacă cineva scoate conteazaCaVizibil din interceptor, cade aici.
    // (3 aug: „silent rotation" a devenit „reîncercare" pe același creier Gemini;
    // 21 aug, lot B: logul MUTE spune și când reîncercarea NU vine — fapta cu
    // efect deja chemată o anulează — deci textul e condițional, nu contiguu.)
    expect(sursaChat).toMatch(/\[CHAT MUTE\][\s\S]{0,200}reîncercare \$\{attempt \+ 1\}/)
  })

  it('plasa anti-tăcere rămâne ultima linie: orice tură fără conținut primește mesaj onest', () => {
    expect(sursaChat).toMatch(/if \(!sawVisible\) \{[\s\S]{0,400}Încearcă din nou în câteva secunde\./)
  })
})

describe('jurnalul uneltelor acoperă toate ramurile executorului', () => {
  it('trace-ul este unic și stă în execTool înainte de ramurile inline', () => {
    const executor = sursaChat.indexOf('const execTool = async')
    const trace = sursaChat.indexOf('console.log(`[tool] ${name}')
    const monitor = sursaChat.indexOf("if (name === 'get_monitor')")
    expect(executor).toBeGreaterThanOrEqual(0)
    expect(trace).toBeGreaterThan(executor)
    expect(trace).toBeLessThan(monitor)
    expect(sursaChat.match(/console\.log\(`\[tool\]/g)).toHaveLength(1)
  })
})

describe('regula de rutare: mesajul normal de chat NU ajunge la constructor', () => {
  it('o cerere de localizare este tură de acțiune (ack instant) — dar se RĂSPUNDE, nu se construiește', () => {
    // Documentează DE CE a apărut „Am preluat sarcina." la o cerere de
    // localizare: verbul de acțiune o face tură „grea" la admin. Fix-ul de mai
    // sus garantează că după ack urmează răspunsul creierului.
    expect(hasActionIntent('arată-mi unde sunt pe hartă')).toBe(true)
  })

  it('ramura de unelte a userului obișnuit NU conține uneltele constructorului', () => {
    const nonAdmin = sursaChat
      .split('\n')
      .find((l) => l.trim().startsWith(': [...googleTools'))
    expect(nonAdmin, 'ramura non-admin a listei de unelte trebuie să existe').toBeTruthy()
    for (const interzisa of [
      'BUILD_SOFTWARE_TOOL',
      'CONSTRUCTOR_STATUS_TOOL',
      'PANOU_COD_TOOL',
      'CERINTA_NOUA_TOOL',
      'CERINTE_LISTA_TOOL',
      'CERINTA_PRIORITATE_TOOL',
      'REPO_WRITE_TOOL',
      'REPO_OPEN_PR_TOOL',
      'REPO_MERGE_PR_TOOL',
    ])
      expect(nonAdmin).not.toContain(interzisa)
  })

  it('build_software e blocat la EXECUȚIE pentru orice non-admin (poarta dublă)', () => {
    expect(sursaChat).toMatch(
      /case 'build_software': \{\s*\n\s*if \(!isAdmin\) return JSON\.stringify\(\{ error: 'admin_only' \}\)/,
    )
  })

  it('uneltele de cerințe/construcție nu sunt nici în setul partajat fără poartă — poarta admin e obligatorie', () => {
    expect(sursaChat).toMatch(
      /if \(SHARED_ADMIN_TOOLS\.has\(block\.name\)\) \{\s*\n\s*if \(!isAdmin\) return JSON\.stringify\(\{ error: 'admin_only' \}\)/,
    )
  })

  it('mesajul de admin cu ordin EXPLICIT („construiește/repară X în aplicație") AJUNGE la constructor', () => {
    // Calea legitimă, neschimbată: unealta build_software pune ordinul în coada
    // reală (build_jobs) și confirmă cu numărul ordinului.
    expect(sursaChat).toMatch(/case 'build_software'[\s\S]{0,1600}createBuildJob\(email, order\)/)
    expect(sursaChat).toMatch(/Am preluat cerința \(ordin #\$\{jobId\}\)\./)
  })

  it('un ordin pornește exact o dată wrapperul instalat al constructorului', () => {
    const start = sursaChat.indexOf('function porneculLucratorulConstructor(): void {')
    const end = sursaChat.indexOf('// ── runTool helper', start)
    const launcher = start >= 0 && end > start ? sursaChat.slice(start, end) : ''
    expect(launcher).toContain("spawn('bash', ['/root/kelion/constructor-worker.sh']")
    expect(launcher).toContain('detached: true')
    expect(launcher).toContain('worker.unref()')
    expect(launcher.match(/constructor-worker\.sh/g)).toHaveLength(1)
    expect(launcher).not.toContain('/root/kelion/deploy/')
    expect(launcher).not.toContain('/root/kelion/atelier/')
  })

  it('definițiile uneltei spun explicit regula: constructorul primește ordine explicite SAU implicite, dar NU întrebări obișnuite de chat', () => {
    // Ambele definiții (chat + sursa comună pentru voce) poartă regula — și
    // implicit (fără cuvântul „construiește"), ca ordinele să nu mai plece la vorbă.
    expect(sursaChat).toMatch(/ROUTING RULE: the constructor receives an explicit OR implicit build\/repair order/)
    expect(sursaDefs).toMatch(/ROUTING RULE: the constructor receives an explicit OR implicit build\/repair order/)
    // Regula „NU întrebări obișnuite" rămâne, în ambele.
    expect(sursaChat).toMatch(/NEVER an ordinary question or chat/)
    expect(sursaDefs).toMatch(/NEVER for an ordinary question or chat/)
  })

  it('panoul Admin → Constructor rămâne singura cale directă (403 pentru non-admin)', () => {
    const sursaConstructor = readFileSync(
      fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)),
      'utf8',
    )
    expect(sursaConstructor).toMatch(
      /app\.post.*'\/api\/admin\/constructor'[\s\S]{0,300}user\.role !== 'admin'\) return reply\.code\(403\)/,
    )
  })
})

describe('turele de ACȚIUNE ale ownerului sunt recunoscute (urcă pe Gemini greu care execută)', () => {
  // Creier 2 cloud (qwen/kimi prin Ollama) a fost SCOS — owner, 20 aug: „rămân
  // doar cu Linux și Gemini Live". Creierul e Gemini, unic; turele grele merg pe
  // Gemini greu (Pro), care CHEAMĂ unealta. Recunoașterea intenției de acțiune
  // rămâne (isOwner && hasActionIntent → tură grea pe Gemini).
  it('comenzile de acțiune sunt recunoscute ca atare (urcă pe Gemini greu care execută)', () => {
    for (const cmd of ['deschide youtube', 'caută prețul la bitcoin', 'pune o melodie', 'fă un audit', 'repară vocea']) {
      expect(hasActionIntent(cmd), `„${cmd}" trebuie să fie tură de acțiune`).toBe(true)
    }
  })
})

describe('vocea și scrisul ajung în ACELAȘI punct (fluxUnic al creierului)', () => {
  it('ruta de voce NU are creier propriu — fără orchestrator, fără apel de model', () => {
    // Dacă vocea capătă vreodată un al doilea creier, cele două căi diverg —
    // exact boala semnalată. Transcrierea vocală trece prin POST /api/chat,
    // aceeași conductă ca mesajul scris.
    expect(sursaRealtime).not.toMatch(/runOrchestrator/)
    expect(sursaRealtime).not.toMatch(/openrouterChat/)
    expect(sursaRealtime).not.toMatch(/brainComplete/)
  })

  it('ruta de voce trimite transcrierea spre /api/chat (aceeași conductă ca scrisul)', () => {
    expect(sursaRealtime).toContain('/api/chat')
  })

})
