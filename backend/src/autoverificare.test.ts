// ── AUTOVERIFICAREA INTELIGENTĂ — dovada verdictului + „DE CE nu merge" ───────
// Owner, 19 aug: „ceva inteligent bazat pe AI care verifică că face toate
// funcțiile" + „verifică și DE CE nu merge". Nucleul (tipFunctie / interpreteazaProba)
// e pur — probat aici pe fiecare tip de rezultat; runner-ul pe dependențe injectate.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  tipFunctie,
  interpreteazaProba,
  ruleazaAutoverificare,
  decideDinMasuratori,
  formatMonitorAutoverificare,
  probaDinRezultatGoogle,
  type VerificareFunctie,
} from './services/autoverificare.js'
import { CAPABILITIES, grupaExecutieUnealta } from './services/brainCapabilities.js'

describe('tipFunctie — citire (probă reală) vs efect (dry-run)', () => {
  it('o citire cunoscută (system_health) e „citire"', () => {
    expect(tipFunctie('system_health')).toBe('citire')
    expect(tipFunctie('stare_masurata')).toBe('citire')
  })
  it('o funcție cu efect (build/ștergere) e „efect"', () => {
    expect(tipFunctie('build_software')).toBe('efect')
    // necunoscuta pornește conservator = efect (nu se execută orb)
    expect(tipFunctie('o_functie_inexistenta')).toBe('efect')
  })
  it('e consistent cu registrul de execuție (grupaExecutieUnealta)', () => {
    for (const c of CAPABILITIES.slice(0, 20)) {
      const asteptat = grupaExecutieUnealta(c.name) === undefined ? 'citire' : 'efect'
      expect(tipFunctie(c.name)).toBe(asteptat)
    }
  })
})

describe('interpreteazaProba — funcții cu EFECT (dry-run, fără cost)', () => {
  it('cablată dar NErulată → NU POT VERIFICA (efect nerulat ≠ verificat, rule #1)', () => {
    const d = interpreteazaProba('build_software', 'efect', { ok: true })
    expect(d.verdict).toBe('nu_pot_verifica')
    expect(d.deCe).toMatch(/cablat/i)
    expect(d.deCe).toMatch(/nu.*rulez|nu pot verifica|efect\/cost/i)
  })
  it('ne-cablată → STRICAT + recomandare fermă', () => {
    const d = interpreteazaProba('build_software', 'efect', { ok: false, eroare: 'nu e în dispecer' })
    expect(d.verdict).toBe('stricat')
    expect(d.recomandare).toMatch(/^REPARĂ/)
  })
})

describe('interpreteazaProba — funcții de CITIRE: verdict + DE CE, pe fiecare cauză', () => {
  it('401/403/sesiune → NU POT VERIFICA (nu e stricăciune, e auth)', () => {
    for (const er of ['HTTP 401 unauthorized', 'forbidden 403', 'nu ești admin']) {
      const d = interpreteazaProba('get_calendar_events', 'citire', { ok: false, eroare: er })
      expect(d.verdict).toBe('nu_pot_verifica')
      expect(d.deCe).toMatch(/autentificare|drepturi/)
    }
  })
  it('cheie/token lipsă (Google/Serper) → NU POT VERIFICA + recomandare fermă', () => {
    const d = interpreteazaProba('web_search', 'citire', { ok: false, eroare: 'SERPER api key lipsă' })
    expect(d.verdict).toBe('nu_pot_verifica')
    expect(d.deCe).toMatch(/cheie|token/)
    expect(d.recomandare).toMatch(/FERM/)
  })
  it('rețea/timeout/5xx → STRICAT (chiar nu merge acum)', () => {
    for (const er of ['ECONNREFUSED 127.0.0.1', 'timeout after 12s', 'HTTP 503 service unavailable']) {
      const d = interpreteazaProba('system_health', 'citire', { ok: false, eroare: er })
      expect(d.verdict).toBe('stricat')
      expect(d.deCe).toMatch(/nu răspunde|rețea|timeout/)
    }
  })
  it('binar/fișier lipsă (ENOENT) → STRICAT + repune dependența', () => {
    const d = interpreteazaProba('server_logs', 'citire', { ok: false, eroare: 'spawn ENOENT no such file' })
    expect(d.verdict).toBe('stricat')
    expect(d.recomandare).toMatch(/instalează|repune/)
  })
  it('argument lipsă/invalid → NU POT VERIFICA (cere o intrare, nu e stricăciune)', () => {
    // owner, 19 aug „eu vreau real": o unealtă probată cu argumente goale care cere
    // o intrare (query/id/text) NU e „stricată" — e „nu pot proba fără intrare".
    for (const er of ['query is required', 'missing required parameter: id', 'lipsește argumentul „text"', 'invalid input', 'trebuie un id']) {
      const d = interpreteazaProba('web_search', 'citire', { ok: false, eroare: er })
      expect(d.verdict, `„${er}" ar trebui nu_pot_verifica`).toBe('nu_pot_verifica')
      expect(d.deCe).toMatch(/intrare/)
    }
  })
  it('altă eroare → STRICAT, de reparat în cod', () => {
    const d = interpreteazaProba('db_query', 'citire', { ok: false, eroare: 'syntax error at or near FROM' })
    expect(d.verdict).toBe('stricat')
    expect(d.deCe).toMatch(/a picat/)
  })
  it('„unealtă necunoscută" din probă → NU POT VERIFICA, calea chat (NU stricat, NU „nu produce nimic")', () => {
    // Măsurat 19 aug: 22 citiri (Google/web/get_time/monitor) ies „necunoscute" din
    // dispecerul `uneltele` fiindcă ele merg pe calea CHAT — nu-s stricate.
    for (const nume of ['get_time', 'web_search', 'get_recent_emails', 'get_monitor']) {
      const d = interpreteazaProba(nume, 'citire', { ok: false, eroare: `unealtă necunoscută: ${nume}` })
      expect(d.verdict).toBe('nu_pot_verifica')
      expect(d.deCe).toMatch(/calea chat/)
      // NU eticheta greșită a lui Kelion („handler neînregistrat / nu produce nimic")
      expect(d.deCe).not.toMatch(/handler|nu produce nimic/)
    }
  })
  it('rezultat gol / eșec auto-declarat → NU POT VERIFICA (regula #1)', () => {
    expect(interpreteazaProba('get_weather', 'citire', { ok: true, rezultat: '' }).verdict).toBe('nu_pot_verifica')
    expect(interpreteazaProba('get_weather', 'citire', { ok: true, rezultat: 'ERROR: nu pot' }).verdict).toBe('nu_pot_verifica')
  })
  it('rezultat plauzibil → MERGE (probat real)', () => {
    const d = interpreteazaProba('get_time', 'citire', { ok: true, rezultat: '2026-08-19T08:00:00Z' })
    expect(d.verdict).toBe('merge')
    expect(d.deCe).toMatch(/probat real/)
  })
})

describe('ruleazaAutoverificare — probează TOATE capabilitățile + îmbogățește AI pe picate', () => {
  it('enumeră toate funcțiile din registru și dă un verdict fiecăreia', async () => {
    const raport = await ruleazaAutoverificare({
      // citirile „merg" (rezultat valid); efectele „cablate" (ok)
      probaCitire: async () => ({ ok: true, rezultat: 'ok-real' }),
      esteCablat: () => true,
    })
    // Efectele NErulate → „nu pot verifica" (nu „merg", audit fake 20 aug): doar
    // CITIRILE probate real se numără la „merg"; efectele cablate stau la nepotverifica.
    const citiri = CAPABILITIES.filter((c) => tipFunctie(c.name) === 'citire').length
    const efecte = CAPABILITIES.length - citiri
    expect(raport.total).toBe(CAPABILITIES.length)
    expect(raport.functii).toHaveLength(CAPABILITIES.length)
    expect(raport.merg).toBe(citiri)
    expect(raport.nepotverifica).toBe(efecte)
    expect(raport.stricate).toBe(0)
  })

  it('o citire picată → STRICAT + „de ce", iar AI îmbogățește diagnosticul', async () => {
    const creierDiag = vi.fn(async (picate: { functie: string }[]) => {
      const m: Record<string, { deCe?: string; recomandare?: string }> = {}
      for (const p of picate) m[p.functie] = { deCe: 'cauză AI mai deșteaptă', recomandare: 'FĂ X' }
      return m
    })
    const raport = await ruleazaAutoverificare({
      probaCitire: async (c) =>
        c.name === 'system_health' ? { ok: false, eroare: 'ECONNREFUSED' } : { ok: true, rezultat: 'ok' },
      esteCablat: () => true,
      creierDiag,
    })
    const sh = raport.functii.find((f) => f.functie === 'system_health')!
    expect(sh.verdict).toBe('stricat')
    expect(sh.deCe).toMatch(/AI: cauză AI mai deșteaptă/) // diagnosticul AI e adăugat
    expect(creierDiag).toHaveBeenCalledOnce()
    expect(raport.stricate).toBeGreaterThanOrEqual(1)
  })

  it('creierul AI jos → rămâne diagnosticul determinist (regula #1, nu inventează)', async () => {
    const raport = await ruleazaAutoverificare({
      probaCitire: async () => ({ ok: false, eroare: 'timeout' }),
      esteCablat: () => true,
      creierDiag: async () => {
        throw new Error('creier jos')
      },
    })
    // toate citirile → stricat cu „de ce" determinist, fără să crape
    expect(raport.functii.some((f) => f.verdict === 'stricat' && /nu răspunde|timeout/.test(f.deCe))).toBe(true)
  })
})

// ── AUTOVERIFICAREA LIVE din CHAT (owner, 19 aug: „eu vreau real") ────────────
// Kelion se probează pe el însuși REAL, pe server, dintr-o unealtă de chat — ca
// ownerul să ceară „verifică-ți funcțiile" (scris/vorbit) și să primească starea
// MĂSURATĂ, nu una declarată. Pinuiește cablajul în cod (o singură logică live,
// refolosită de rută ȘI de unealtă — fără duplicare).
describe('autoverificarea LIVE e cablată în chat + refolosită de rută', () => {
  const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
  const admin = readFileSync(fileURLToPath(new URL('./routes/admin.ts', import.meta.url)), 'utf8')

  it('unealta autoverificare e definită, în lista admin, cu executor admin-only', () => {
    expect(chat).toMatch(/const AUTOVERIFICARE_TOOL: Tool = \{/)
    expect(chat).toMatch(/name: 'autoverificare'/)
    expect(chat).toMatch(/CONSTRUCTOR_COMMAND_TOOL, AUTOVERIFICARE_TOOL/)
    const idx = chat.indexOf("case 'autoverificare':")
    expect(idx).toBeGreaterThanOrEqual(0)
    const bloc = chat.slice(idx, idx + 700)
    expect(bloc).toMatch(/if \(!isAdmin\) return JSON\.stringify\(\{ error: 'admin_only' \}\)/)
    expect(bloc).toMatch(/autoverificareLive\(\)/)
  })

  it('rularea live e ÎNTR-UN SINGUR loc — ruta admin o refolosește (fără duplicare)', () => {
    expect(admin).toMatch(/const \{ autoverificareLive \} = await import\('\.\.\/services\/autoverificare\.js'\)/)
    expect(admin).toMatch(/await autoverificareLive\(\)/)
  })

  it('registrul are capabilitatea autoverificare (admin, prin creier pe voce)', () => {
    const c = CAPABILITIES.find((x) => x.name === 'autoverificare')
    expect(c, 'autoverificare lipsește din registru').toBeTruthy()
    expect(c!.admin).toBe(true)
    expect(c!.chat).toBe(true)
  })

  it('unealta întoarce PLANUL măsurat + nota anti-invenție (LEGEA 5)', () => {
    const idx = chat.indexOf("case 'autoverificare':")
    const bloc = chat.slice(idx, idx + 1600)
    expect(bloc).toMatch(/decideDinMasuratori\(raport\.functii\)/)
    expect(bloc).toMatch(/\bplan,/)
    expect(bloc).toMatch(/NU inventa cauze/)
  })

  it('LEGEA 5 (decizia măsurată) e în legile mereu-prezente ale adminului', () => {
    expect(chat).toMatch(/5\. LAW OF THE MEASURED DECISION/)
    expect(chat).toMatch(/An unmeasured cause is "nu stiu inca", not a fact/)
    expect(chat).toMatch(/Measure first IS the step/)
  })
})

// ── MĂSURĂTORILE DECIZIONALE (owner, 19 aug: „să nu se mai repete") ───────────
// Derivă acțiunea DIN verdictul măsurat — deci, prin construcție, nu poate inventa
// o cauză. Ce n-are cauză clară de cod → „măsoară întâi", nu reparație oarbă.
describe('decideDinMasuratori — decizia urmează măsurătoarea, nu ghicește', () => {
  const f = (functie: string, verdict: VerificareFunctie['verdict'], deCe: string): VerificareFunctie => ({
    functie, categorie: 'x', face: 'x', tip: 'citire', verdict, deCe, recomandare: '', dovada: '',
  })

  it('ce MERGE nu produce nicio acțiune', () => {
    expect(decideDinMasuratori([f('a', 'merge', 'probat real')])).toEqual([])
  })

  it('ENOENT/binar lipsă (măsurat) → REPARĂ (instalează dependența)', () => {
    const d = decideDinMasuratori([f('server_logs', 'stricat', 'lipsește un binar/fișier necesar: spawn ENOENT')])
    expect(d[0].actiune).toBe('repara')
    expect(d[0].urmatoareaMasuratoare).toMatch(/instalează|repune/)
  })

  it('rețea/serviciu jos (măsurat) → MĂSOARĂ ÎNTÂI (poate fi tranzitoriu, nu cod)', () => {
    const d = decideDinMasuratori([f('system_health', 'stricat', 'serviciul nu răspunde (rețea/timeout): ECONNREFUSED')])
    expect(d[0].actiune).toBe('masoara_intai')
    expect(d[0].urmatoareaMasuratoare).toMatch(/re-probează după ce.*revine|tranzitoriu/)
  })

  it('cheie/token lipsă → RECONFIGUREAZĂ (pune cheia), nu reparație de cod', () => {
    const d = decideDinMasuratori([f('web_search', 'nu_pot_verifica', 'lipsește cheia/tokenul necesar (Serper)')])
    expect(d[0].actiune).toBe('reconfigureaza')
  })

  it('auth 401/403 → MĂSOARĂ ÎNTÂI (re-probează logat), nu reparație', () => {
    const d = decideDinMasuratori([f('get_calendar_events', 'nu_pot_verifica', 'cere autentificare/drepturi')])
    expect(d[0].actiune).toBe('masoara_intai')
    expect(d[0].urmatoareaMasuratoare).toMatch(/logat|sesiune/)
  })

  it('„calea chat" → MĂSOARĂ ÎNTÂI: probeaz-o din chat (nu reparație, nu intrare)', () => {
    const d = decideDinMasuratori([f('get_time', 'nu_pot_verifica', 'se execută pe calea chat, nu prin dispecerul de probă')])
    expect(d[0].actiune).toBe('masoara_intai')
    expect(d[0].urmatoareaMasuratoare).toMatch(/din chat/)
  })

  it('fiecare decizie poartă cauza MĂSURATĂ (nu inventează nimic peste findings)', () => {
    const findings = [f('x', 'stricat', 'a picat: crash intern'), f('y', 'merge', 'ok')]
    const d = decideDinMasuratori(findings)
    expect(d).toHaveLength(1) // doar cele care nu merg
    expect(d[0].deCe).toBe('a picat: crash intern') // cauza vine DIN finding, nu de altundeva
  })
})

// ── PROBAREA REALĂ A UNELTELOR GOOGLE/„APLICAȚII" (owner, 19 aug: „da") ───────
describe('probaDinRezultatGoogle — date reale = MERGE, semnal de eroare = corect clasificat', () => {
  it('date reale (Gmail a întors emailuri) → MERGE', () => {
    const p = probaDinRezultatGoogle(JSON.stringify([{ from: 'x', subject: 'Salut' }]))
    expect(p.ok).toBe(true)
    expect(p.rezultat).toMatch(/Salut/)
    // interpretat de nucleu → merge
    expect(interpreteazaProba('get_recent_emails', 'citire', p).verdict).toBe('merge')
  })
  it('google_not_connected → EROARE „reconectează" → nu_pot_verifica (nu stricat)', () => {
    const p = probaDinRezultatGoogle(JSON.stringify({ error: 'google_not_connected' }))
    expect(p.ok).toBe(false)
    expect(p.eroare).toMatch(/reconectează|token/)
    expect(interpreteazaProba('get_calendar_events', 'citire', p).verdict).toBe('nu_pot_verifica')
  })
  it('argument lipsă (read_email fără query) → eroare păstrată → nu_pot_verifica „cere intrare"', () => {
    const p = probaDinRezultatGoogle(JSON.stringify({ error: 'query is required' }))
    expect(p.ok).toBe(false)
    expect(interpreteazaProba('read_email', 'citire', p).verdict).toBe('nu_pot_verifica')
  })
  it('text simplu (nu JSON) → rezultat real, MERGE', () => {
    const p = probaDinRezultatGoogle('rezultat text nestructurat')
    expect(p.ok).toBe(true)
    expect(p.rezultat).toBe('rezultat text nestructurat')
  })
})

// ── AFIȘAREA OBLIGATORIE PE MONITOR (owner, 19 aug) ──────────────────────────
describe('formatMonitorAutoverificare + afișarea server-side obligatorie', () => {
  const f = (functie: string, verdict: VerificareFunctie['verdict'], deCe: string): VerificareFunctie => ({
    functie, categorie: 'x', face: 'x', tip: 'citire', verdict, deCe, recomandare: '', dovada: '',
  })
  const raport = (functii: VerificareFunctie[]) => ({
    total: functii.length,
    merg: functii.filter((x) => x.verdict === 'merge').length,
    stricate: functii.filter((x) => x.verdict === 'stricat').length,
    nepotverifica: functii.filter((x) => x.verdict === 'nu_pot_verifica').length,
    functii,
  })

  it('documentul poartă rezumatul + CE NU MERGE, întâi stricatele', () => {
    const functii = [f('a', 'merge', 'ok'), f('b', 'stricat', 'a picat: X'), f('c', 'nu_pot_verifica', 'lipsă cheie')]
    const r = raport(functii)
    const doc = formatMonitorAutoverificare(r, decideDinMasuratori(functii))
    expect(doc.title).toMatch(/Autoverificare — 3 funcții/)
    expect(doc.text).toMatch(/✅ 1 merg.*❌ 1 stricate.*… 1 nu pot verifica.*din 3/s)
    expect(doc.text).toMatch(/CE NU MERGE/)
    // stricatul „b" apare înaintea nesigurului „c"
    expect(doc.text.indexOf('b —')).toBeLessThan(doc.text.indexOf('c —'))
  })

  it('totul verde → spune că toate MERG, fără listă de probleme', () => {
    const functii = [f('a', 'merge', 'ok'), f('b', 'merge', 'ok')]
    const doc = formatMonitorAutoverificare(raport(functii), [])
    expect(doc.text).toMatch(/Toate cele 2 funcții verificate MERG/)
    expect(doc.text).not.toMatch(/CE NU MERGE sau NU POT VERIFICA/)
  })

  it('executorul SCRIE raportul pe monitor server-side (obligatoriu), nu la alegerea modelului', () => {
    const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
    const idx = chat.indexOf("case 'autoverificare':")
    const bloc = chat.slice(idx, idx + 1700)
    expect(bloc).toMatch(/formatMonitorAutoverificare\(raport, plan\)/)
    expect(bloc).toMatch(/reply\.raw\.write\(`\$\{CTRL\}\$\{JSON\.stringify\(\{ doc: \{ title: doc\.title, text: doc\.text \} \}\)\}\$\{CTRL\}`\)/)
    expect(bloc).toMatch(/afisatPeMonitor: true/)
  })
})
