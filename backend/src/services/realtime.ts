import { config } from '../config.js'
import { langLabel } from './lang.js'
import { googleTools } from './google.js'

// ── VOCE LIVE — proxy SDP către OpenAI Realtime (WebRTC) ─────────────────────
// Arhitectura (reconstruită fidel din aplicația live, adusă în git ca sursă
// unică): browserul face oferta WebRTC și trimite SDP-ul la backend; backendul
// îl relayează la OpenAI cu cheia ascunsă pe server și INJECTEAZĂ server-side
// modelul, o SINGURĂ voce masculină și persona/limba persistată a userului.
// Clientul nu vede niciodată cheia, modelul sau vocea — le controlăm noi.
//
// Contract OpenAI verificat LIVE cu cheia reală (22 iul):
//   POST https://api.openai.com/v1/realtime/calls
//   Authorization: Bearer <OPENAI_KEY>
//   multipart/form-data: sdp=<oferta browserului>, session=<JSON config>
//   → întoarce answer-ul SDP (text). `audio.output.voice` fixează vocea;
//     `instructions` fixează persona + limba; `model` alege modelul realtime.

const OPENAI_CALLS = 'https://api.openai.com/v1/realtime/calls'

// Persona Kelion pentru VOCE — consistentă cu voiceTurn.ts (ton cald, scurt,
// vorbit), plus blocajul ABSOLUT de limbă (aceeași regulă ca în chat): Kelion
// vorbește EXCLUSIV în limba persistată a userului, orice ar auzi.
export function realtimeInstructions(lang: string, meserie?: string | null, hardLock = false): string {
  const rol = meserie
    ? ` Ai rolul activ ales de utilizator: „${meserie}" — răspunde din perspectiva acestui rol.`
    : ''
  const persona =
    `Ești Kelion, un asistent AI cu o SINGURĂ voce masculină, caldă, calmă și ` +
    `naturală. Vorbești ca într-o conversație reală: propoziții scurte (1–3), ` +
    `fără liste, fără markdown, fără emoji, fără să enumeri pași dacă nu ți se cere. ` +
    `Ești chemat pe nume „Kelion". Te porți mereu ca un gentleman: politicos, ` +
    `respectuos, calm — NICIODATĂ grosolan, vulgar sau strident. ` +
    `Dacă NU auzi vorbire CLARĂ (tăcere, zgomot de fundal, fragmente neinteligibile), ` +
    `TACI — nu răspunde, nu iniția tu conversația, așteaptă o propoziție reală.` +
    // „KELION/KEI ÎN FAȚĂ" (Adrian, 26 iul: „de ce nu merge chestia cu Kelion
    // sau Kei în față?"): numele e ADRESAREA. Când în cameră se vorbește cu
    // altcineva, Kelion nu se bagă; numele îl cheamă înapoi. Fără asta, în
    // full-duplex răspundea la ORICE auzea, inclusiv la discuții care nu-i
    // erau adresate.
    ` ADRESAREA PE NUME: răspunzi când ți se adresează („Kelion" sau „Kei") ` +
    `sau când continuă firesc conversația cu tine. Dacă auzi clar că utilizatorul ` +
    `vorbește cu ALTĂ persoană (nu cu tine — alt nume, altă direcție a discuției), ` +
    `TACI și așteaptă; numele tău te recheamă imediat în conversație.` +
    // OCHI + ESCALADARE (Adrian: „de ce nu vede, de ce nu escaladează?"). Vocea
    // avea uneltele, dar nu i se spunea să le folosească → nu vedea, nu urca.
    ` Ai OCHI, dar DOI diferiți — nu-i confunda (regula lui Adrian, 27 iul): ` +
    `CAMERA („look") e DOAR pentru contextul clar de cameră — „mă vezi?", „ce vezi ` +
    `pe cameră?", „uită-te la asta", „citește ce-ți arăt"; MONITORUL („get_monitor") ` +
    `e pentru „ce e pe monitor/ecran?", „ce mi-ai afișat?" — citește ce e afișat ` +
    `chiar acum și vorbește despre AIA. Să răspunzi cu camera la o întrebare ` +
    `despre monitor e greșeală gravă.` +
    // COMENZILE DE AFIȘARE (Adrian, 27 iul, dovadă live: „deschide pe monitor
    // youtube" → „nu e nimic pe monitor" în loc de execuție; apoi pagina
    // youtube deschisă ca embed — fără redare). Regula: ordinul se EXECUTĂ.
    ` COMENZI DE AFIȘARE: „deschide/pune/arată pe monitor X" e ORDIN — deschide ` +
    `X ACUM cu unealta potrivită; nu e întrebare despre monitor: NU chema ` +
    `get_monitor înainte și NU răspunde „nu e nimic pe monitor" (gol e starea ` +
    `normală de pornire). YOUTUBE/MUZICĂ/VIDEO: singura cale care REDĂ cu sunet ` +
    `e youtube_search (playerul încorporat pornește singur). NU deschide ` +
    `NICIODATĂ youtube.com cu show_on_screen — pagina refuză încadrarea și nu ` +
    `poate reda. Dacă ți se cere YouTube fără o piesă anume, întreabă într-o ` +
    `propoziție scurtă ce să pui, apoi cheamă youtube_search cu răspunsul.` +
    ` GESTURILE PE CONTEXT: când conținutul o cere firesc — un salut la salut, ` +
    `arătatul spre monitor când afișezi ceva, o expresie la o veste — cheamă ` +
    `play_avatar_gesture cu gestul potrivit, cumpătat, ca un gentleman: rar și ` +
    `cu rost, niciodată teatral.` +
    ` Pentru cereri GRELE (analiză, cod, matematică, raționament lung, planificare, ` +
    `explicații aprofundate) NU improviza și NU vorbi între timp: cheamă DIRECT unealta ` +
    `„ask_brain" cu întrebarea completă, TACI cât lucrează expertul (nu spune „stai să ` +
    `verific", nu umple tăcerea), apoi rostește NATURAL răspunsul expertului — o singură ` +
    `voce, fără să te suprapui. Cererile simple le răspunzi direct.` +
    // ACCES LA PROPRIUL COD ȘI LA PROPRIILE DATE (Adrian, 27 iul: „Kelion nu
    // poate vedea tot codul sursă al lui, de ce?" — putea, dar doar creierul
    // din scris are uneltele; vocea nega accesul în loc să escaladeze).
    ` AI ACCES INTEGRAL la propriul tău cod sursă (fiecare fișier), la baza ta de ` +
    `date permanentă și la starea proceselor tale — prin „ask_brain": expertul are ` +
    `uneltele de citit/căutat sursa, SQL pe baza de date, starea rulărilor și poate ` +
    `chiar construi/modifica soft la ordinul ownerului. NU spune NICIODATĂ „nu am ` +
    `acces la codul meu/baza mea de date" — escaladează prin ask_brain și adu răspunsul.` +
    // REGULA FAPTEI (Adrian, 27 iul: „când zice că face ceva trebuie să și
    // facă — rămâne doar declarativ"): zis fără unealtă = minciună.
    ` REGULA FAPTEI: nu spune NICIODATĂ „am făcut", „trimit", „mă ocup", „am salvat" ` +
    `fără să fi chemat CHIAR ACUM unealta corespunzătoare și să ai rezultatul ei. ` +
    `Ai unealtă → o chemi întâi, apoi vorbești despre rezultatul REAL. N-ai unealtă ` +
    `pentru ce ți se cere → spui sincer că încă nu poți și mergi mai departe. ` +
    `O acțiune declarată fără dovada uneltei e minciună.` +
    rol
  // LIMBA (Adrian, 24 iul: „default engleză; când mă aude, schimbă TOT pe limba
  // mea și o menține per user"). Dacă userul ARE deja o limbă stabilită, o
  // păstrăm (consistență între sesiuni). Dacă NU (user nou, limbă nedetectată),
  // pornim în ENGLEZĂ și OGLINDIM limba pe care o vorbește userul, stabil.
  //
  // GARDĂ DE LIMBĂ (Adrian, 24 iul: „vorbește în altă limbă" — dovadă live:
  // Kelion răspundea în RUSĂ la vorbire românească). Fără ancoră, transcrierea
  // audio ghicea printre TOATE limbile și auzea româna ca rusă. Constrângem
  // vocea EXCLUSIV la cele 7 limbi ale aplicației; orice nesiguranță → ENGLEZĂ;
  // niciodată rusă/ucraineană sau altceva din afara listei.
  const SUPPORTED = 'English, Romanian, French, Spanish, Portuguese, Italian, German'
  const guard =
    `\n\nLANGUAGE — HARD RULES: You may speak ONLY in one of these languages: ` +
    `${SUPPORTED}. NEVER answer in Russian, Ukrainian, or any language outside ` +
    `this list. If you are ever unsure which language you heard, answer in ` +
    `English. Never mix two languages in one reply.`
  const known = /^[a-z]{2}$/.test(lang)
  // HARD LOCK (Adrian, admin, în Italia): „adminul primește română MEREU,
  // indiferent ce aude". Fără lock, când Adrian aude/spune italiană vocea comuta
  // pe italiană → „2 voci: ro și italiană". Cu lock, limba NU se schimbă NICIODATĂ.
  const limba = hardLock && known
    ? `\n\nLIMBĂ: vorbește EXCLUSIV în ${langLabel(lang)}, MEREU — inclusiv ` +
      `SALUTUL și prima ta replică, din primul cuvânt. NU comuta NICIODATĂ pe ` +
      `altă limbă, orice ai auzi — chiar dacă utilizatorul sau fundalul e în ` +
      `italiană, engleză sau altceva, tu răspunzi tot în ${langLabel(lang)}.`
    : known
    ? `\n\nLIMBĂ: limba stabilită a utilizatorului este ${langLabel(lang)}. ` +
      `Vorbește în ${langLabel(lang)} și păstreaz-o consecvent toată conversația. ` +
      `Schimbă DOAR dacă utilizatorul chiar începe să vorbească susținut în altă ` +
      `limbă DIN LISTA de mai sus.`
    : `\n\nLIMBĂ: începe în ENGLEZĂ. Detectează limba în care vorbește EFECTIV ` +
      `utilizatorul (dintr-o propoziție clară, DOAR din lista de mai sus) și ` +
      `de-atunci răspunde EXCLUSIV în acea limbă, consecvent pentru tot restul ` +
      `conversației. NU comuta pe cuvinte scurte/ambigue ("ok", "salut", "hello") ` +
      `— așteaptă o propoziție clară.`
  return persona + guard + limba
}

// ── UNELTELE VOCII (Adrian, 24 iul: „nu apelează instrumentele, îi lipsesc
// instrumente de a afișa pe ecran... de ce nu e autonom") ────────────────────
// Sesiunea Realtime primea DOAR persona — zero funcții → în voce Kelion nu
// putea afișa nimic și nu era autonom. Acum primește ACELEAȘI unelte ca chatul
// scris (subsetul relevant): clientul primește apelul pe dataChannel, îl
// execută prin POST /api/realtime/tool (serverul rulează runGoogleTool cu
// cheile lui) și deschide monitorul din screen_url. show_on_screen se execută
// direct în client (monitorul e al browserului).
const VOICE_TOOL_NAMES = new Set([
  'web_search', 'get_weather', 'maps_search', 'maps_directions', 'youtube_search',
  'translate_text', 'wikipedia_lookup', 'convert_currency', 'get_time',
  'get_calendar_events', 'get_recent_emails', 'send_email', 'create_calendar_event',
  'get_drive_files', 'get_tasks', 'add_task', 'search_contacts', 'add_contact',
  // IMPORTUL COMPLET GOOGLE (Adrian, 27 iul) e ACTIV ÎN CHAT, dar NU aici.
  // DOVADA CRONOLOGICĂ (28 iul): la 22:09, cu 31 de unelte, reproducerea de pe
  // VPS a primit 201 în 0,4s, 3/3. La 22:20 importul Google a urcat vocea la 37
  // de unelte — și de ATUNCI /api/realtime/session primește 504 la FIECARE
  // încercare (27s, trei conexiuni diferite, deci nu e pană trecătoare).
  // Sesiunea de voce e trimisă întreagă la pornire; peste un anumit prag
  // marginea OpenAI n-o mai procesează la timp. Vocea rămâne pe setul dovedit;
  // uneltele noi se re-adaugă doar una câte una, fiecare probată live.
  // 'read_email', 'read_drive_file', 'get_photos', 'my_youtube',
  // 'delete_calendar_event', 'complete_task',
])

export function realtimeTools(
  dynamic: { name: string; description: string; input_schema: unknown }[] = [],
): { type: 'function'; name: string; description: string; parameters: unknown }[] {
  const fromGoogle = googleTools
    .filter((t) => VOICE_TOOL_NAMES.has(t.name))
    .map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema,
    }))
  // AUTO-EXTINDERE: uneltele dinamice aprobate, disponibile și în voce.
  const fromDynamic = dynamic.map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
  return [
    ...fromGoogle,
    ...fromDynamic,
    {
      // GPS LA CERERE (pana din 26 iul: după scoaterea fluxului permanent —
      // regula lui Adrian „doar când e necesară detecția locației" — vocea NU
      // avea NICIO cale să afle poziția → „GPS nu e accesibil". Unealta asta se
      // execută ÎN BROWSER (clientul citește GPS-ul real al dispozitivului pe
      // loc), nu prin /api/realtime/tool.
      type: 'function',
      name: 'get_location',
      description:
        "Read the user's REAL current position from the device GPS, right now. Call it whenever the user asks where they are, says \"here\"/\"near me\", or an answer needs their current location and you don't have FRESH coordinates. Returns lat/lon. Never guess or refuse a location question without calling this first.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      type: 'function',
      name: 'show_on_screen',
      description:
        "Show a web page on the user's monitor (the surface behind you). Call with an empty url to CLEAR the screen when the conversation moves to a new subject.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to display, or empty string to clear the screen.' },
          title: { type: 'string', description: 'Short tab title.' },
        },
        required: ['url'],
      },
    },
    {
      // PLAYGROUND DE COD ÎN VOCE (Adrian, 25 iul): Kelion scrie o pagină web
      // completă și o rulează live pe monitor (cadru izolat), userul o poate salva.
      type: 'function',
      name: 'run_web_app',
      description:
        "Write a COMPLETE standalone web page (HTML with inline CSS+JS) and run it LIVE on the user's monitor, in a sandboxed frame. Use to build/test a small working thing on the spot: a clock, calculator, to-do list, chart, form, mini-game, animation, demo. The user sees it running and can save it. Prefer this over show_on_screen whenever the user asks you to build/make/test a page, app, widget, clock, calculator or game — never embed an external site for these. Self-contained (no network-loaded scripts).",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short panel title / save file name.' },
          html: { type: 'string', description: 'The FULL self-contained HTML document (inline CSS + JS).' },
        },
        required: ['title', 'html'],
      },
    },
    {
      // ACCES REAL LA APLICAȚIE (Adrian, 24 iul: „în full-duplex Kelion trebuie
      // să poată intra în orice tab al aplicației, real"). Deschide panourile
      // proprii ale aplicației prin voce — clientul execută direct (e UI-ul lui).
      type: 'function',
      name: 'open_app_view',
      description:
        "Open a panel/tab INSIDE the Kelionai app on the user's screen (not a web page). Use when the user asks to open settings, their wallet/credits, contact, the admin panel, or go back to the main screen. For the admin panel you may also pass a section.",
      parameters: {
        type: 'object',
        properties: {
          view: {
            type: 'string',
            enum: ['settings', 'wallet', 'contact', 'admin', 'home'],
            description:
              'Which app panel to open: settings, wallet (credits & top-up), contact, admin (owner only), or home (close panels).',
          },
          section: {
            type: 'string',
            enum: ['finance', 'users', 'visitors', 'vchat', 'history', 'gaps', 'share', 'stores', 'inbox', 'voiceprints', 'gesturi', 'tokenuri', 'constructor', 'recuperare'],
            description: 'Optional admin section (only when view=admin).',
          },
        },
        required: ['view'],
      },
    },
    {
      // VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"). Kelion privește prin camera
      // userului. Clientul injectează cadrul curent în `image` înainte de a
      // trimite apelul la server (vezi ChatPanel onToolCall).
      type: 'function',
      name: 'get_monitor',
      description:
        "See what is FACTUALLY on YOUR MONITOR right now — the surface AND its real render state (stareReala: 'ok' rendered, 'error' failed, 'loading'). Call it when the user asks what's on screen, AND right after you show something to confirm it truly appeared. If stareReala is 'error', do NOT say you showed it — try another way and repeat until 'ok'. This is NOT the camera — the physical world goes through look.",
      parameters: { type: 'object', properties: {} },
    },
    {
      type: 'function',
      name: 'look',
      description:
        "Look through the user's CAMERA at the physical world in front of them RIGHT NOW. Call this ONLY when the context clearly refers to the camera or the real space: 'mă vezi?', 'ce vezi pe cameră?', 'uită-te la asta', 'citește ce-ți arăt'. NEVER for questions about the MONITOR/screen content ('ce e pe monitor?', 'ce mi-ai afișat?') — for those call get_monitor instead; answering a monitor question with the camera is a serious mistake.",
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Optional: what specifically to look for or read.' },
        },
        required: [],
      },
    },
    {
      type: 'function',
      name: 'generate_image',
      description: 'Generate an image from a text prompt and show it on the monitor.',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'What to draw.' } },
        required: ['prompt'],
      },
    },
    {
      // ESCALADAREA ÎN VOCE (Adrian, 24 iul: „incrementează automat modelele pe
      // nivel de dificultate, de la chat live voce până la cereri foarte grele"):
      // la o cerere GREA, modelul de voce predă întrebarea CREIERULUI (modelul
      // work — Claude/GPT prin OpenRouter) și rostește răspunsul expertului.
      type: 'function',
      name: 'ask_brain',
      description:
        "HEAVY requests only — deep analysis, architecture, coding, math, long multi-step reasoning, anything that needs an expert brain. Pass the user's full request; you get back the expert answer to read aloud (summarize naturally, do not read markdown).",
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: "The user's full request, with any needed context." },
        },
        required: ['request'],
      },
    },
    // PARITATE VOCE↔CHAT (Adrian, 25 iul: „tot activat, Kelion să le poată folosi"):
    // notițe, memorie, gesturi, rol — apelabile și din voce, ca în scris.
    {
      type: 'function',
      name: 'save_note',
      description: 'Save a short note for the user to remember later.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'The note text.' } }, required: ['text'] },
    },
    {
      type: 'function',
      name: 'list_notes',
      description: "List the user's saved notes.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      type: 'function',
      name: 'delete_note',
      description: 'Delete a saved note by its id.',
      parameters: { type: 'object', properties: { id: { type: 'number', description: 'The note id to delete.' } }, required: ['id'] },
    },
    {
      type: 'function',
      name: 'play_avatar_gesture',
      description:
        "Make the avatar perform a short gesture — YOU direct the movement: bind it to the action in progress. Presenting something on the monitor (weather, map, document) → 'arata-inainte' (point with the right hand at the screen) WHILE you present it; greeting → 'salut'; thanks → 'multumire'; good news → 'entuziasm'; thinking → 'ganditor'; also: uimire, surpriza, aprobare, acord-discret, stai-putin, dezamagire, nedumerire, victorie, plecaciune, dans (only if explicitly asked). Composed gentleman: nothing on neutral replies, never the same gesture twice in a row.",
      parameters: { type: 'object', properties: { gesture: { type: 'string', description: 'Gesture name.' } }, required: ['gesture'] },
    },
    {
      type: 'function',
      name: 'set_active_role',
      description: "Set or clear the user's active professional role (meserie). Pass id 0 to clear.",
      parameters: { type: 'object', properties: { id: { type: 'number', description: 'Role id, or 0 to clear.' } }, required: ['id'] },
    },
  ]
}

// MOTIVUL EȘECULUI, CITIBIL DE MAȘINĂ (28 iul): clientul primea doar „502" și
// nu putea nici să explice userului, nici să decidă dacă merită reîncercat.
// Codurile de aici urcă neschimbate în corpul JSON al rutei.
export type RealtimeFailCode =
  | 'realtime_not_configured' // n-avem cheie — nu e vina upstreamului
  | 'upstream_timeout' // am tăiat noi firul: marginea OpenAI n-a răspuns la timp
  | 'upstream_unreachable' // rețea căzută / DNS / TLS
  | 'upstream_5xx' // 500/502/503/504 de la marginea OpenAI (pagina Cloudflare)
  | 'upstream_empty' // 2xx dar answer SDP gol → browserul n-are ce negocia
  | 'upstream_refuz' // 4xx: cererea noastră e greșită (nu se reîncearcă)

export type RealtimeAnswer =
  | { ok: true; sdp: string }
  | { ok: false; status: number; code: RealtimeFailCode; error: string; attempts: number }

// ── ROBUSTEȚEA PORNIRII VOCII (28 iul) ───────────────────────────────────────
// Bugete MĂSURATE pe trafic real, nu ghicite:
//   • o pornire SĂNĂTOASĂ întoarce 201 în ~0,4s (3/3 reproduceri, 27 iul);
//   • una BOLNAVĂ arde ~15s și întoarce 504 cu pagină HTML Cloudflare.
// Deci 6s e deja de 15 ori bugetul unei porniri sănătoase: ce n-a răspuns până
// atunci nu mai răspunde. Tăiem NOI firul înainte ca marginea să ajungă la
// 504-ul ei de la ~15s și cheltuim secundele salvate pe o conexiune NOUĂ —
// asta e diferența dintre 3 șanse reale și una singură lungă și inutilă.
const ATTEMPT_TIMEOUT_MS = 6_000
const MAX_ATTEMPTS = 3
// Plafon TOTAL al rutei: userul stă cu microfonul deschis, uitându-se la ecran.
// 6s + 0,35s + 6s + 1s + 6s = 19,35s în cel mai rău caz — toate cele 3 încercări
// primesc fereastra întreagă și tot ieșim mai repede decât cei 31s de dinainte,
// când erau doar două încercări pe aceeași conexiune spartă.
const TOTAL_BUDGET_MS = 21_000

// Relay o ofertă SDP la OpenAI Realtime și întoarce answer-ul SDP.
export async function openaiRealtimeAnswer(
  offerSdp: string,
  lang: string,
  meserie?: string | null,
  hardLock = false,
  contextBlock = '',
): Promise<RealtimeAnswer> {
  if (!config.openai.key)
    return { ok: false, status: 503, code: 'realtime_not_configured', error: 'realtime_not_configured', attempts: 0 }

  // Uneltele dinamice aprobate (auto-extindere) — și în voce.
  const { dynamicToolDefs } = await import('./dynamicTools.js')
  const dynamic = await dynamicToolDefs().catch(() => [])

  // Codul ISO-639-1 al limbii userului — INDICIU pentru transcriere DOAR când
  // limba e CUNOSCUTĂ (persistată). Când nu e (user nou), NU fixăm nimic —
  // transcrierea detectează singură limba vorbită (altfel am fi împins-o greșit
  // spre o limbă anume și „interpreta greșit" — bug-ul văzut live cu franceza).
  const iso = /^[a-z]{2}$/.test((lang || '').toLowerCase()) ? lang.toLowerCase() : ''

  const persona = realtimeInstructions(lang, meserie, hardLock)
  const ctx = contextBlock || ''
  const tools = realtimeTools(dynamic)

  // SESIUNEA, CU O TREAPTĂ DE DEGRADARE (28 iul). Mărimi MĂSURATE pe sursa vie,
  // nu estimate: persona + cele 31 de unelte = ~18KB (din care ~13,8KB uneltele
  // și ~5,4KB doar descrierile lor), plus contextul (memorie + 20 de replici)
  // → ~26KB în total. NU scoatem unelte din sesiune: uneltele SUNT felul în
  // care vocea acționează, iar varianta „unelte per răspuns" a API-ului ar muta
  // decizia în client (alt fișier, altă bucată de cod) — o rescriere mult mai
  // mare decât problema. Pe ULTIMA încercare trimitem însă o sesiune slăbită:
  // aceleași NUME și aceiași PARAMETRI (deci vocea poate chema în continuare
  // ORICE unealtă), doar descrierile scurtate și contextul plafonat — ~8KB mai
  // puțin. Dacă upstreamul chiar se îneacă în corp, tot pornim cu voce
  // completă; dacă nu, n-am pierdut nimic: pe drumul fericit (încercarea 1)
  // sesiunea pleacă neatinsă.
  const buildSession = (slim: boolean): Record<string, unknown> => ({
    type: 'realtime',
    model: config.openai.realtimeModel,
    audio: {
      // ── DETECȚIE AUDIO ULTRA-PERFORMANTĂ (Adrian, 24 iul: „detecția audio
      // defectă") ──────────────────────────────────────────────────────────
      input: {
        // Reducere de zgomot ambiental (microfon aproape de gură) → VAD-ul și
        // transcrierea nu se mai încurcă în fundal, cameră, ecou.
        noise_reduction: { type: 'near_field' },
        // Transcrierea vorbirii userului cu modelul MARE (nu „mini") + indiciul
        // de limbă DOAR când e cunoscută → transcript exact. Fără asta, GA nu
        // emite NICIODATĂ transcriptul userului.
        transcription: iso
          ? { model: config.openai.realtimeTranscribeModel, language: iso }
          : { model: config.openai.realtimeTranscribeModel },
        // VAD SEMANTIC: un model decide când userul chiar a terminat de vorbit
        // (nu pe tăcere brută). `interrupt_response:true` = barge-in real.
        // POARTA NUMELUI, MECANICĂ (ordinul lui Adrian: „Kelion nu are voie să
        // inițieze conversații; nu intră în chat dacă nu își aude numele").
        // Regula doar în prompt pierdea mereu — cu `create_response:true`
        // modelul primea cuvântul la ORICE frază. Acum răspunsul NU se mai
        // creează automat: CLIENTUL (realtimeVoice.ts) îl creează DOAR dacă
        // transcriptul conține numele („Kelion"/„Kei", regex tolerant la
        // transcriere stâlcită) SAU conversația e deja activă (fereastră de
        // 120s reînnoită la fiecare schimb, DESCHISĂ la pornirea sesiunii —
        // lecția „nu mă aude" din 24/27 iul). Plase anti-surzenie în client:
        // transcript lipsă după speech_stopped → răspunde oricum dacă e
        // conversație activă. „STOP" închide fereastra până la următorul nume.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: config.openai.realtimeVadEagerness,
          create_response: false,
          interrupt_response: true,
        },
      },
      output: { voice: config.openai.realtimeVoice },
    },
    // O SINGURĂ injecție (25 iul — Adrian: „injectezi a mia oară, dublezi").
    // Instrucțiuni + context (memorie + istoric) intră AICI, în sesiunea inițială,
    // care e ACCEPTATĂ de OpenAI (201). Nu mai există al doilea strat prin
    // session.update — era exact dublura.
    // PERSONA NU SE TAIE NICIODATĂ (limba, poarta numelui, regula faptei) —
    // plafonăm doar CONTEXTUL, partea variabilă și cea mai grasă.
    instructions: persona + (slim ? ctx.slice(0, 1200) : ctx),
    // Autonomia vocii: aceleași unelte ca în chatul scris (vezi realtimeTools).
    tools: slim ? tools.map((t) => ({ ...t, description: t.description.slice(0, 160) })) : tools,
    // NU URCA ASTA LA 'required' — regulă, nu preferință. La nivel de SESIUNE,
    // 'required' obligă modelul să cheme o unealtă la FIECARE răspuns, inclusiv
    // pe răspunsul care procesează rezultatul uneltei dinainte → buclă de unelte
    // din care nu mai iese și Kelion nu mai vorbește deloc.
    // Forțarea faptei se face PER RĂSPUNS, din client, doar pe turele de ordin:
    // { type:'response.create', response:{ tool_choice:'required' | {type:'function',name} } }
    // Tura următoare revine singură la 'auto', fără session.update. Vezi
    // frontend/src/lib/realtimeVoice.ts (poarta faptei în voce).
    tool_choice: 'auto',
  })

  // CORPUL SE RECONSTRUIEȘTE LA FIECARE ÎNCERCARE.
  // Suspiciunea „un FormData se consumă o singură dată, deci reîncercarea
  // retrimite un corp gol" a fost MĂSURATĂ, nu presupusă: pe Node 22.22.2
  // (undici), același obiect FormData retrimis de 3 ori a pus pe fir de fiecare
  // dată corpul ÎNTREG (19218 octeți, cu Content-Length, fără chunked). Deci NU
  // asta a rupt reîncercarea din 27 iul. Îl reconstruim totuși per încercare,
  // fiindcă ultima trimite o sesiune DIFERITĂ (slăbită) — și fiindcă un corp
  // rezidit e oricum imun la orice schimbare viitoare de undici.
  const buildForm = (slim: boolean): FormData => {
    const form = new FormData()
    form.append('sdp', offerSdp)
    // CA STRING, NU CA BLOB (25 iul — al 3-lea incident „vorbește rusă" + „nu
    // vede/nu escaladează în voce"): Blob-ul intra în form-data ca FIȘIER
    // (filename="blob") și parserul OpenAI îl IGNORA — de-aia „missing_model"
    // cerea modelul în URL deși era în JSON: sesiunea NU era citită DELOC. Deci
    // nici instrucțiunile, nici vocea, nici limba, nici uneltele nu se aplicau
    // vreodată — modelul rula pe DEFAULT (oglindea limba percepută, răspundea la
    // zgomot). String simplu = câmp de formular normal, parsat.
    form.append('session', JSON.stringify(buildSession(slim)))
    return form
  }

  // FIX FINAL VOCE (dovadă live 24 iul: OpenAI „missing_model"): API-ul Realtime
  // GA cere modelul ca PARAMETRU ÎN URL, nu doar în JSON-ul de sesiune.
  const callsUrl = `${OPENAI_CALLS}?model=${encodeURIComponent(config.openai.realtimeModel)}`

  // ── DE CE „NU SE DECLANȘA" TIMEOUT-UL, deși ruta ținea 31s ────────────────
  // Nu era stricat nimic: AbortSignal.timeout(20s) era armat corect, PER
  // încercare, și pornea chiar la fetch. Doar că nicio încercare nu ajungea la
  // 20s — marginea OpenAI (Cloudflare) închidea singură cu 504 pe la ~15s, deci
  // fetch-ul se termina NORMAL, cu răspuns în mână. Cei 31s din log sunt exact
  // 15s (încercarea 1) + 0,9s pauză + 15s (încercarea 2): timpul DUBLAT de
  // reîncercarea adăugată, nu un fetch agățat. Concluzia: un plafon de 20s e mai
  // mare decât răbdarea reală a upstreamului, deci nu apucă niciodată să
  // folosească la ceva. Acum tăiem la 10s și cheltuim diferența pe altceva.
  //
  // ── ȘI DE CE N-A AJUTAT REÎNCERCAREA ─────────────────────────────────────
  // Fiindcă pleca pe ACEEAȘI conexiune: undici ține socketul în pool și după un
  // 504, iar reîncercarea la 0,9s reintra fix pe calea care tocmai picase →
  // același 504, previzibil. De la a doua încercare cerem conexiune NOUĂ.
  // Verificat local pe Node 22.22.2: 3 cereri fără antet = 2 socketuri
  // (refolosire), 3 cereri cu `Connection: close` = 3 socketuri (zero refolosire).
  //
  // Pauză scurtă și crescătoare: un hopa de câteva sute de ms al marginii îl
  // sărim, dar dacă e pană reală nu ardem bugetul stând degeaba.
  const pause = (attempt: number): Promise<void> =>
    new Promise((res) => setTimeout(res, attempt === 1 ? 350 : 1_000))

  const startedAt = Date.now()
  let lastStatus = 502
  let lastErr = ''
  let lastCode: RealtimeFailCode = 'upstream_unreachable'
  let attempts = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Nu pornim o încercare care oricum nu încape în bugetul rămas — ar ține
    // userul agățat pe o cerere pe care o abandonăm noi înșine.
    const left = TOTAL_BUDGET_MS - (Date.now() - startedAt)
    if (left < 2_000) break
    attempts = attempt

    const headers: Record<string, string> = { Authorization: `Bearer ${config.openai.key}` }
    if (attempt > 1) headers.connection = 'close'

    let r: Response
    try {
      r = await fetch(callsUrl, {
        method: 'POST',
        headers,
        body: buildForm(attempt === MAX_ATTEMPTS),
        signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, left)),
      })
    } catch (e) {
      // AbortError/TimeoutError = plafonul NOSTRU (upstreamul era prea lent);
      // orice altceva = rețea/DNS/TLS. Ambele se reîncearcă — asta lipsea.
      const nume = (e as Error | undefined)?.name ?? ''
      const expirat = nume === 'AbortError' || nume === 'TimeoutError'
      lastCode = expirat ? 'upstream_timeout' : 'upstream_unreachable'
      lastStatus = expirat ? 504 : 502
      lastErr = `${lastCode}: ${String(e).slice(0, 160)}`
      if (attempt < MAX_ATTEMPTS) {
        await pause(attempt)
        continue
      }
      break
    }

    const text = await r.text().catch(() => '')
    if (r.ok && text.trim()) return { ok: true, sdp: text }
    if (r.ok) {
      // 2xx CU CORP GOL e tot o pornire moartă: browserul ar arunca pe
      // setRemoteDescription și userul ar vedea „fără voce" la un 200 vesel.
      lastCode = 'upstream_empty'
      lastStatus = 502
      lastErr = 'answer SDP gol de la upstream'
      if (attempt < MAX_ATTEMPTS) {
        await pause(attempt)
        continue
      }
      break
    }

    lastStatus = r.status
    lastErr = text.slice(0, 300)
    // 5xx (inclusiv 504-ul cu pagină Cloudflare), 408 și 429 = necaz TRECĂTOR al
    // marginii → mai încercăm. Restul de 4xx = cererea noastră e greșită
    // („missing_model", cheie invalidă): reîncercarea ar doar întârzia eroarea
    // reală cu câteva secunde, fără nicio șansă în plus.
    const trecator = r.status >= 500 || r.status === 408 || r.status === 429
    lastCode = trecator ? 'upstream_5xx' : 'upstream_refuz'
    if (trecator && attempt < MAX_ATTEMPTS) {
      await pause(attempt)
      continue
    }
    break
  }
  return { ok: false, status: lastStatus, code: lastCode, error: lastErr, attempts }
}
