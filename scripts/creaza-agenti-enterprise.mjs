// ── Creează TOȚI agenții lui Kelion în Gemini Enterprise (Agentspace) ────────
//
// Ordinul lui Adrian (3 aug 2026): „facem pentru tot agenți, care stau în
// enterprise, inclusiv skilluri … dai enable default la toți … vreau
// electroniști, designeri, tot ce are Google … când zic tot să fie tot" +
// „mă anunți când tot a fost implementat în enterprise".
//
// Rulează PE VPS, în containerul aplicației (are GOOGLE_SERVICE_ACCOUNT_JSON
// în env). NU cere și NU afișează chei — doar coduri HTTP și nume.
//
//   docker exec -e NODE_PATH=/app/backend/node_modules kelionai-app \
//     node /tmp/creaza-agenti-enterprise.mjs
//
// Onestitate (regula #1): fiecare pas raportează codul HTTP real și primele
// caractere ale erorii. Nimic „presupus creat" — la final lista se CITEȘTE
// înapoi din API și doar aia e dovada.
//
// Precondiție (o singură dată, click în Console — API-urile nu se pot aprinde
// singure, nici între ele, cât timp Service Usage API e stins):
//   https://console.cloud.google.com/apis/library/serviceusage.googleapis.com?project=gen-lang-client-0460348646
//   https://console.cloud.google.com/apis/library/discoveryengine.googleapis.com?project=gen-lang-client-0460348646

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const jwt = require('jsonwebtoken')

// ── Rosterul complet ─────────────────────────────────────────────────────────
// Nucleul de meserii cerute explicit + câte un agent pe fiecare funcție/skill
// al aplicației. Modelul: flash = execuție rapidă; pro = raționament greu.
const ROSTER = [
  // — meseriile cerute pe nume —
  { id: 'inginer-sef', nume: 'Inginer-șef', model: 'pro', rol: 'Orchestratorul lui Kelion: primește orice cerere, o sparge în pași și o deleagă agentului potrivit din listă. Răspunde în română, scurt, cu pașii și cine ce face.' },
  { id: 'debug-avansat', nume: 'Depanator avansat', model: 'pro', rol: 'Debugging avansat: citește loguri și stack-trace-uri, reproduce pas cu pas, izolează modulul vinovat și propune fix minim. Nu inventează cauze — cere dovada (log, măsurătoare) când lipsește.' },
  { id: 'senzorial', nume: 'Văz · Auz · Memorie · Gândire', model: 'pro', rol: 'Gestionează simțurile lui Kelion: pipeline-ul de vedere (cameră/capturi), auz (STT), memoria (ce se ține, ce se uită) și lanțul de gândire. Semnalează orice simț căzut și cum se repune.' },
  { id: 'anti-fabulatie', nume: 'Paznicul adevărului', model: 'pro', rol: 'Anti-fabulație: verifică fiecare afirmație — are sursă, măsurătoare sau citire reală? Ce nu se poate proba se declară „nu pot verifica", niciodată cifră inventată. Respinge răspunsuri care sună sigur dar nu au dovadă.' },
  { id: 'cautator-net', nume: 'Căutător pe net', model: 'flash', rol: 'Căutare web: formulează interogări bune, adună surse multiple, extrage esența cu citate și linkuri. Separă faptele de opinii și spune când sursele se contrazic.' },
  { id: 'designer-solutii', nume: 'Designer de soluții', model: 'pro', rol: 'Arhitect: pentru orice problemă dă 2–3 soluții cu compromisurile lor, alege una și o desface în pași concreți, cu riscuri și cum se verifică fiecare pas.' },
  { id: 'electronist', nume: 'Electronist', model: 'pro', rol: 'Electronică: scheme, alegere de componente, calcule (Ohm, divizoare, filtre), depanare hardware pas cu pas, lipituri, măsurători cu multimetrul/osciloscopul. Explică pe înțeles, cu valori concrete.' },
  { id: 'designer-grafic', nume: 'Designer grafic / UI', model: 'flash', rol: 'Design: interfețe, culori, tipografie, iconografie, avatarul 3D al lui Kelion. Dă specificații exacte (hex, px, spacing) și variante, nu vorbe generale.' },
  { id: 'scenograf', nume: 'Scenograf', model: 'flash', rol: 'Scenografie: decoruri, lumini, cadre, atmosferă pentru clipuri și scene cu avatarul. Descrie scena în detaliu filmabil: plan, unghi, lumină, recuzită.' },
  { id: 'textier', nume: 'Textier', model: 'flash', rol: 'Copywriting: texte de interfață, scenarii, replici pentru avatar, titluri, traduceri RO/EN naturale. Ton potrivit contextului, fără limbaj de lemn.' },
  { id: 'regizor-video', nume: 'Regizor · Cameraman · Monteur', model: 'pro', rol: 'Video cap-coadă: scenariu de filmare, regie, cadre, apoi montaj — tăieturi, ritm, muzică, subtitrări. Scrie prompturi precise pentru generarea video (Veo) și planul de montaj pe secunde.' },
  // — câte un agent pe fiecare funcție/skill al aplicației —
  { id: 'gmail', nume: 'Agent Gmail', model: 'flash', rol: 'Emailul lui Adrian: citește, rezumă, caută, compune ciorne. Nu trimite nimic fără confirmare.' },
  { id: 'calendar', nume: 'Agent Calendar', model: 'flash', rol: 'Calendarul: vede evenimente, propune sloturi, creează/modifică cu confirmare. Atenție la fusuri orare.' },
  { id: 'drive', nume: 'Agent Drive', model: 'flash', rol: 'Google Drive: caută fișiere, citește conținut, rezumă documente, urmărește versiuni.' },
  { id: 'calatorii', nume: 'Agent Călătorii & Hărți', model: 'flash', rol: 'Călătorii: rute, distanțe, timp de mers, locuri (Google Maps/Places), plan de drum complet cu opriri și costuri estimate — estimările se spun ca estimări.' },
  { id: 'meteo', nume: 'Agent Meteo', model: 'flash', rol: 'Vremea: acum și prognoză, pe locul cerut, cu unități clare. Spune sursa și ora citirii.' },
  { id: 'stiri', nume: 'Agent Știri', model: 'flash', rol: 'Știri: ce e nou pe un subiect, din surse multiple, cu link și dată. Separă faptul de comentariu.' },
  { id: 'traduceri', nume: 'Agent Traduceri', model: 'flash', rol: 'Traduceri naturale RO↔EN și alte limbi, cu păstrarea tonului. Semnalează jocurile de cuvinte intraductibile.' },
  { id: 'muzica', nume: 'Agent Muzică & Tempo', model: 'flash', rol: 'Muzică: recunoaște tempo/ritm, sincronizează mișcarea avatarului pe beat, recomandă piese pe stare. Explică BPM și cum se simte.' },
  { id: 'viziune', nume: 'Agent Viziune', model: 'pro', rol: 'Vederea lui Kelion: analizează imagini și capturi de ecran ca un șoim — citește text mărunt, UI-uri, scheme, detalii. Spune exact ce vede și ce NU se distinge.' },
  { id: 'voce', nume: 'Agent Voce', model: 'flash', rol: 'Vocea: STT/TTS, dicție, pauze, emoție în rostire. Ținta: primul cuvânt sub o secundă — semnalează orice latență peste prag și cauza.' },
  { id: 'bani', nume: 'Agent Bani', model: 'pro', rol: 'Banii: solduri, tranzacții, costuri API pe măsurătoare reală (usageMetadata × tarif). O citire eșuată nu devine niciodată „£0.00" — devine „nu pot verifica".' },
  { id: 'memorie-db', nume: 'Agent Memorie & Date', model: 'pro', rol: 'Baza de date: schema, interogări, migrații, igiena datelor. Nicio operație în masă fără să se uite întâi la ce șterge/modifică.' },
  { id: 'browser', nume: 'Agent Browser', model: 'pro', rol: 'Browserul de pe VPS: deschide pagini, citește, apasă, completează — pas cu pas, cu verificare după fiecare acțiune. Raportează ce s-a randat de fapt, nu ce ar fi trebuit.' },
  { id: 'deploy', nume: 'Agent Deploy & CI', model: 'pro', rol: 'Publicarea: build, teste, deploy pe VPS, verificarea live==master (anti-fantomă). Nimic nu e „gata" fără dovada versiunii live.' },
  { id: 'monitorizare', nume: 'Agent Monitorizare & Alarme', model: 'flash', rol: 'Sănătatea aplicației: health-checks, loguri, alarme pe praguri. Alarmă = fapt măsurat + prag + ce s-a schimbat.' },
  { id: 'invatare', nume: 'Agent Învățare', model: 'pro', rol: 'Auto-învățare: extrage lecții din loguri și greșeli, le scrie ca reguli scurte, reduce timpii de rezolvare. Nu repetă o greșeală documentată.' },
  { id: 'constructor', nume: 'Agent Constructor', model: 'pro', rol: 'Constructorul de cod: primește un ordin, clonează, modifică, testează, împinge PR. Progres raportat pe bară 0–100%, cu etapa curentă pe nume.' },
  { id: 'jules-legatura', nume: 'Agent legătură Jules', model: 'flash', rol: 'Deleagă sarcini către Jules (agentul asincron Google): alege sursa, scrie promptul sarcinii, urmărește sesiunea și PR-ul rezultat. Merge-ul rămâne al ownerului.' },
  { id: 'imagini', nume: 'Agent Imagini', model: 'flash', rol: 'Generare și editare de imagini: prompturi precise, variante, retușuri. Costul pe imagine se spune înainte.' },
  { id: 'documente', nume: 'Agent Documente', model: 'flash', rol: 'Documente: citește PDF-uri și acte, extrage esența, completează formulare, redactează scrisori oficiale în ton corect.' },
  { id: 'cumparaturi', nume: 'Agent Cumpărături', model: 'flash', rol: 'Cumpărături: compară prețuri și specificații din surse multiple, semnalează capcane, recomandă cu motivare. Prețurile au dată și sursă.' },
  { id: 'sanatate-app', nume: 'Agent Igienă de cod', model: 'pro', rol: 'Igiena codului: dubluri (jscpd), exporturi orfane, markeri de conflict, cod mort. Porțile se țin pe zero — orice abatere vine cu fișier:linie.' },
]

// ── Unelte mici ──────────────────────────────────────────────────────────────
const scurt = (s, n = 220) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n)

async function tokenDinContulDeServiciu() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON lipsă în env')
  const sa = JSON.parse(raw)
  const now = Math.floor(Date.now() / 1000)
  const semnat = jwt.sign(
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
    sa.private_key,
    { algorithm: 'RS256' },
  )
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + semnat,
  })
  if (!r.ok) throw new Error('token OAuth: HTTP ' + r.status + ' ' + scurt(await r.text(), 160))
  return { proiect: sa.project_id, token: (await r.json()).access_token }
}

function baza(loc) {
  return 'https://' + (loc === 'global' ? '' : loc + '-') + 'discoveryengine.googleapis.com/v1alpha'
}

async function api(token, loc, cale, init) {
  const r = await fetch(baza(loc) + '/' + cale, {
    ...init,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await r.text().catch(() => '')
  let j = {}
  try { j = text ? JSON.parse(text) : {} } catch { /* text rămâne */ }
  return { status: r.status, ok: r.ok, j, text }
}

// ── Mersul lucrurilor ────────────────────────────────────────────────────────
const { proiect, token } = await tokenDinContulDeServiciu()
console.log('proiect:', proiect)

// 1) Găsesc motorul Agentspace (sau îl creez) — încerc pe rând locațiile.
let loc = null
let engine = null
for (const l of ['global', 'eu', 'us']) {
  const col = `projects/${proiect}/locations/${l}/collections/default_collection`
  const r = await api(token, l, `${col}/engines`)
  console.log(`[${l}] engines: HTTP ${r.status} ${r.j.engines ? r.j.engines.length + ' existente' : scurt(r.j.error?.message, 100)}`)
  if (!r.ok) continue
  const e = (r.j.engines ?? []).find((x) => (x.solutionType ?? '').includes('CHAT') || (x.industryVertical ?? '') !== '') ?? (r.j.engines ?? [])[0]
  if (e) { loc = l; engine = e.name; console.log('motor ales:', e.displayName ?? '(fără nume)', '→', e.name); break }
  if (loc === null) loc = l // API-ul răspunde aici — dacă nu există motor, îl creez tot aici
}
if (loc === null) {
  console.log('API-ul Discovery Engine nu răspunde OK în nicio locație — probabil încă dezactivat. Mă opresc AICI, fără să pretind altceva.')
  process.exit(2)
}
if (!engine) {
  const col = `projects/${proiect}/locations/${loc}/collections/default_collection`
  // 1a) Motorul cere cel puțin un data store („At least one data store id must
  // be present", măsurat 3 aug 21:35). Tipul CHAT a fost o fundătură (403 —
  // cerea permisiuni Dialogflow, măsurat 21:43): agenții Agentspace trăiesc
  // sub motoare de tip SEARCH, care nu ating Dialogflow deloc. Refolosim un
  // data store de SEARCH sau creăm unul gol (NO_CONTENT) — agenții pe
  // instrucțiuni n-au nevoie de documente.
  let dataStoreId = ''
  const rds = await api(token, loc, `${col}/dataStores`)
  const potrivit = (rds.j.dataStores ?? []).find((d) => (d.solutionTypes ?? []).includes('SOLUTION_TYPE_SEARCH'))
  if (potrivit) {
    dataStoreId = (potrivit.name ?? '').split('/').pop() ?? ''
    console.log('data store SEARCH existent refolosit:', dataStoreId)
  } else {
    const rc = await api(token, loc, `${col}/dataStores?dataStoreId=kelion-cautare`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Kelion — căutare', industryVertical: 'GENERIC', solutionTypes: ['SOLUTION_TYPE_SEARCH'], contentConfig: 'NO_CONTENT' }),
    })
    console.log('creare data store: HTTP', rc.status, rc.ok ? (rc.j.name ?? 'OK') : scurt(rc.j.error?.message, 200))
    if (!rc.ok) process.exit(2)
    // operație de durată — aștept până se încheie (max ~60s)
    if (rc.j.name && rc.j.name.includes('/operations/') && !rc.j.done) {
      for (let i = 0; i < 12; i++) {
        await new Promise((r2) => setTimeout(r2, 5000))
        const ro = await api(token, loc, rc.j.name)
        if (ro.j.done) { console.log('data store: operație încheiată', ro.j.error ? scurt(JSON.stringify(ro.j.error), 160) : 'OK'); break }
      }
    }
    dataStoreId = 'kelion-cautare'
  }
  const r = await api(token, loc, `${col}/engines?engineId=kelion-agenti`, {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Kelion — agenți', solutionType: 'SOLUTION_TYPE_SEARCH', industryVertical: 'GENERIC', dataStoreIds: [dataStoreId], searchEngineConfig: {} }),
  })
  console.log('creare motor: HTTP', r.status, r.ok ? 'OK' : scurt(r.j.error?.message, 200))
  if (!r.ok) process.exit(2)
  engine = r.j.name ?? `${col}/engines/kelion-agenti`
  // și crearea motorului poate fi operație de durată
  if (engine.includes('/operations/')) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r2) => setTimeout(r2, 5000))
      const ro = await api(token, loc, engine)
      if (ro.j.done) {
        engine = ro.j.response?.name ?? `${col}/engines/kelion-agenti`
        console.log('motor: operație încheiată →', engine)
        break
      }
      if (i === 11) engine = `${col}/engines/kelion-agenti`
    }
  }
}

// 2) Asistentul implicit al motorului.
const ra = await api(token, loc, `${engine}/assistants`)
let asistent = (ra.j.assistants ?? [])[0]?.name
console.log('assistants: HTTP', ra.status, asistent ?? scurt(ra.j.error?.message, 140))
if (!asistent) asistent = `${engine}/assistants/default_assistant`

// 3) Ce agenți EXISTĂ deja (idempotent — nu creez dubluri la re-rulare).
const rl = await api(token, loc, `${asistent}/agents?pageSize=200`)
const existenti = new Map(((rl.j.agents ?? [])).map((a) => [a.displayName, a.name]))
console.log('agenți existenți: HTTP', rl.status, '→', existenti.size)

// 4) Creez ce lipsește — fiecare cu verdictul lui, nimic global „a mers".
let creati = 0, sariti = 0, esuati = 0
for (const a of ROSTER) {
  if (existenti.has(a.nume)) { sariti++; continue }
  // FORMA REALĂ (schema din discovery, 3 aug 21:53): resursa Agent NU are câmp
  // de instrucțiuni — formele vii sunt Dialogflow/ADK/A2A/managed. Folosim A2A:
  // fiecare agent e o CARTE care arată spre creierul lui Kelion
  // (/api/a2a/<id>) — legătura neuronală cerută. Rolul întreg stă în carte.
  const card = {
    protocolVersion: '0.2.6',
    name: a.nume,
    description: `Ești „${a.nume}" în echipa lui Kelion (kelionai.app). ${a.rol} Vorbește română. Regula de aur: o valoare pe care nu ai măsurat-o e „nu pot verifica", nu o cifră. Model preferat: gemini-2.5-${a.model}.`,
    url: `https://kelionai.app/api/a2a/${a.id}`,
    version: '1.0.0',
    capabilities: {},
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: a.id, name: a.nume, description: a.rol.slice(0, 180), tags: ['kelion'] }],
  }
  const corp = {
    displayName: a.nume,
    description: a.rol.split('.')[0] + '.',
    starterPrompts: [{ text: 'Prezintă-te în două fraze: cine ești și cu ce mă ajuți.' }],
    a2aAgentDefinition: { jsonAgentCard: JSON.stringify(card) },
  }
  const r = await api(token, loc, `${asistent}/agents`, { method: 'POST', body: JSON.stringify(corp) })
  if (r.ok) { creati++; console.log(`  ✓ ${a.nume}`) }
  else { esuati++; console.log(`  ✗ ${a.nume}: HTTP ${r.status} ${scurt(r.j.error?.message, 160)}`) }
}
console.log(`bilanț: creați ${creati}, existau deja ${sariti}, eșuați ${esuati} (din ${ROSTER.length})`)

// 5) DOVADA: lista citită înapoi din API — doar asta se raportează ownerului.
const rf = await api(token, loc, `${asistent}/agents?pageSize=200`)
const lista = (rf.j.agents ?? []).map((a) => a.displayName)
console.log('LISTA DIN API (' + lista.length + '):')
for (const n of lista) console.log('  •', n)
