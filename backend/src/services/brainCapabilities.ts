import { config } from '../config.js'

// ── THE SINGLE REGISTRY OF KELION'S CAPABILITIES (SINGLE BRAIN §5) ───────────
// Adrian, Jul 29: "if the brain doesn't REALLY store everything the software
// has, there's no point". This is the SINGLE source of truth: every function
// of the software, once, with where it reaches (chat / voice) and whether it's
// admin-only. From here derive both the chat's tool list and the voice's —
// without duplication.
//
// THE GUARD (brainCapabilities.test.ts): if a function exists but the brain
// can't reach it, the test FAILS.
//
// AUG 1 — THE ONE-BRAIN ARCHITECTURE (Adrian: "let the brain use the model's
// voice and functions; no two separate entities"): the voice session is pure
// ears+mouth and holds NO tools at all — the old 31-tool Realtime ceiling is
// gone. A spoken turn goes through POST /api/chat exactly like a typed one, so
// EVERY chat capability is reachable by voice (`voiceViaBrain`) and
// `dormantOnVoice()` is structurally empty. The §1/§6 target — what typing can
// do, voice can do too — is no longer a roadmap, it's the architecture.

export interface Capability {
  /** The tool's name, exactly as the model sees it. */
  readonly name: string
  /** The group, for display and audit. */
  readonly category: string
  /** What it does, briefly (one sentence). */
  readonly does: string
  /** Can the CHAT brain reach it? */
  readonly chat: boolean
  /** Can the DIRECT VOICE session reach it? ALWAYS false since Aug 1 (the ONE-
   *  brain architecture): the Realtime session is ears+mouth only and holds NO
   *  tools — the old 31-tool ceiling is gone for good. */
  readonly voice: boolean
  /** Can it be reached by speaking, through the ONE BRAIN (POST /api/chat — the
   *  same pipeline, tools and ladder as writing)? Aug 1: voice turns ARE chat
   *  turns, so everything chat can do, voice can do — `voiceViaBrain` mirrors
   *  `chat`, and `dormantOnVoice()` is structurally empty. */
  readonly voiceViaBrain?: boolean
  /** Owner only (destructive tools / introspection). */
  readonly admin: boolean
}

// The single source. Order = the order in the KELION-CREIER-UNIC.md spec.
export const CAPABILITIES: readonly Capability[] = [
  // 2.1 Communication & display
  { name: 'show_on_screen', category: 'afisare', does: 'pune un URL/dată pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'show_document', category: 'afisare', does: 'pune un text/rezultat pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'run_web_app', category: 'afisare', does: 'rulează o pagină scrisă de el (izolat)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'generate_image', category: 'afisare', does: 'generează o imagine', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'generate_video', category: 'afisare', does: 'generează video prin serviciul OpenAI configurat sau raportează indisponibilitatea', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'vede_video', category: 'vedere', does: 'vede un clip YouTube și extrage ideile/informațiile (fișă catalogată + învățată)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'lista_tarife', category: 'afisare', does: 'citește meniul VIU de prețuri al extra-serviciilor (cifra spusă = cifra taxată)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'studioul_de_clipuri', category: 'afisare', does: 'plan de clip: scenariu, pași și prompt pentru generatorul OpenAI configurat', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'open_app_view', category: 'afisare', does: 'deschide panourile aplicației', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'proceseaza_date', category: 'afisare', does: 'procesează date tabelare (CSV/JSON): parse + agregări/profil, arătate pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.2 Google (23) — +create_doc/edit_doc/create_sheet/edit_sheet (L1i, 12 aug)
  { name: 'get_recent_emails', category: 'google', does: 'citește antetele emailurilor recente', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'read_email', category: 'google', does: 'citește corpul COMPLET al unui email (după căutare)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'send_email', category: 'google', does: 'trimite email', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_calendar_events', category: 'google', does: 'citește calendarul', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'create_calendar_event', category: 'google', does: 'pune un eveniment în calendar', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'delete_calendar_event', category: 'google', does: 'șterge un eveniment din calendar (după id)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'complete_task', category: 'google', does: 'bifează un task ca terminat (după id)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_drive_files', category: 'google', does: 'listează fișierele Drive', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'read_drive_file', category: 'google', does: 'citește conținutul unui fișier Drive (după căutare)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'create_doc', category: 'google', does: 'creează un Google Doc (titlu + conținut)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  // Produsele alese de owner (14 aug): Slides + Forms; Meet e parametru pe
  // create_calendar_event (nu unealtă nouă — aceeași intrare în calendar).
  { name: 'create_presentation', category: 'google', does: 'creează o prezentare Google Slides (titlu + slide-uri) — extra-serviciu cu tarif', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'create_form', category: 'google', does: 'creează un Google Form (titlu + întrebări)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'photos_alege', category: 'google', does: 'pornește alegerea de poze din Google Photos (Picker — omul alege, Kelion vede doar alegerea)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'photos_adu', category: 'google', does: 'aduce pozele alese din Google Photos și le arată pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'youtube_urca', category: 'google', does: 'urcă un clip din aplicație pe canalul YouTube al omului (privat implicit; consimțământ separat)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'business_vezi', category: 'google', does: 'vede profilul de firmă Google al omului (contul + locațiile; consimțământ separat, cotă doar după aprobarea Google)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'edit_doc', category: 'google', does: 'editează un Google Doc (adaugă / rescrie / caută-înlocuiește)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'create_sheet', category: 'google', does: 'creează un Google Sheet (titlu + rânduri)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'edit_sheet', category: 'google', does: 'editează un Google Sheet (adaugă rânduri / scrie într-un interval)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_tasks', category: 'google', does: 'citește task-urile', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'add_task', category: 'google', does: 'adaugă un task', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'search_contacts', category: 'google', does: 'caută contacte', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'add_contact', category: 'google', does: 'adaugă un contact', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'web_search', category: 'google', does: 'căutare web', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'youtube_search', category: 'google', does: 'caută + redă YouTube', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_weather', category: 'google', does: 'vremea (cu GPS-ul real)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'maps_search', category: 'google', does: 'caută locuri pe hartă', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'maps_directions', category: 'google', does: 'trasee pe hartă', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'translate_text', category: 'google', does: 'traduce text', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'wikipedia_lookup', category: 'google', does: 'caută pe Wikipedia', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'convert_currency', category: 'google', does: 'schimb valutar', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_time', category: 'google', does: 'ora/data', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'lookup_address', category: 'google', does: 'adresa+codul poștal din coordonate (sau invers)', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.3 Constructor boundary and bounded diagnostics — admin
  { name: 'build_software', category: 'cod', does: 'pune direct în build_jobs un ordin validat pentru OpenCode (motor configurat separat)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'constructor_status', category: 'cod', does: 'starea ordinelor de construcție', chat: true, voice: false, voiceViaBrain: true, admin: true },
  // THE OWNER'S REQUIREMENTS (Jul 30): the table existed, but nobody filled
  // it — requirements stayed in chat and got lost. These three fill it from
  // speech.
  { name: 'cerinta_noua', category: 'ops', does: 'notează pe loc ce a cerut ownerul, cu criteriul de acceptare', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'cerinte_lista', category: 'ops', does: 'unde stă fiecare cerință (nouă/analizată/în lucru/livrată/verificată)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'cerinta_prioritate', category: 'ops', does: 'cât de urgentă e o cerință — ordinea o dă ownerul', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'system_health', category: 'cod', does: 'sănătatea proprie', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'server_logs', category: 'cod', does: 'jurnalele serverului', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'client_errors', category: 'cod', does: 'erorile din browser (F12) ale utilizatorilor', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'ask_brain', category: 'cod', does: 'raționament profund (cod/analiză)', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.4 Live browser (9) — admin
  { name: 'browser_open', category: 'browser', does: 'deschide un site', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_click', category: 'browser', does: 'dă click în pagină', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_type', category: 'browser', does: 'scrie în pagină', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_read', category: 'browser', does: 'citește pagina', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_back', category: 'browser', does: 'înapoi în istoric', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_scroll', category: 'browser', does: 'derulează pagina', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_close', category: 'browser', does: 'închide browserul', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_key', category: 'browser', does: 'apasă o tastă', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_click_at', category: 'browser', does: 'click la coordonate', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.5 Memory & notes
  { name: 'save_note', category: 'memorie', does: 'salvează o notiță', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'list_notes', category: 'memorie', does: 'listează notițele', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'delete_note', category: 'memorie', does: 'șterge o notiță', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'list_memories', category: 'memorie', does: 'memoria de lungă durată', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'cauta_istoric', category: 'memorie', does: 'caută în istoricul complet de chat (voce+scris) după cuvinte-cheie', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'dovada_faptelor', category: 'memorie', does: 'scoate dovada SALVATĂ a faptelor (jurnalul operațional): obiectiv + stare finală + evenimentele măsurate ale uneltelor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'forget_memory', category: 'memorie', does: 'uită o memorie', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'read_inbox', category: 'memorie', does: `își citește propria cutie poștală (${config.product.supportEmail})`, chat: true, voice: false, voiceViaBrain: true, admin: true },

  // 2.6 Sight & place
  { name: 'look', category: 'vedere', does: 'camera (vede utilizatorul / ce i se arată)', chat: false, voice: false, voiceViaBrain: true, admin: false },
  { name: 'evenimente_sonore', category: 'auz', does: 'indicii FFT ambientale neconcludente (zgomot brusc, posibilă conversație/muzică, liniște)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_monitor', category: 'vedere', does: 'ce e FAPTIC pe monitor (conținutul tabului activ)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'click_monitor', category: 'vedere', does: 'dă click la coordonate x,y pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'zoom_monitor', category: 'vedere', does: 'mărește/micșorează (zoom) pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_mouse_position', category: 'vedere', does: 'află poziția mouse-ului și ce indică pe ecran', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'arata_pe_grafic', category: 'vedere', does: 'pune pointeri de indicație pe graficul de trading (linie colorată cu săgeată + vorbele lui, fix pe preț) — „arată clar ce zice"', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'goleste_monitorul', category: 'vedere', does: 'golește monitorul (închide todo ce e afișat)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_location', category: 'vedere', does: 'GPS-ul real al dispozitivului', chat: false, voice: false, voiceViaBrain: true, admin: false },

  // 2.7 Money & state — admin
  { name: 'get_real_cost', category: 'bani', does: 'costul real', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'list_updates', category: 'bani', does: 'ce update-uri a primit', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'prepare_promo_clip', category: 'bani', does: 'pregătește un clip promo', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'episoade_promo', category: 'bani', does: 'jurnalul seriei de clipuri (ep1, ep2…) — ce a filmat și unde a rămas', chat: true, voice: false, voiceViaBrain: true, admin: true },

  // Miscellaneous
  { name: 'log_unsupported_request', category: 'diverse', does: 'notează o cerință imposibilă acum', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'set_active_role', category: 'diverse', does: 'schimbă rolul activ', chat: true, voice: false, voiceViaBrain: true, admin: false },
  // COMPLETAREA REGISTRULUI (C4 al marii verificări, 22 aug): 5 unelte
  // OFERITE creierului dar neînregistrate — o unealtă din afara registrului
  // putea fi UMBRITĂ de o unealtă dinamică omonimă (gardul anti-umbrire
  // judecă pe allCapabilityNames), iar legea sursei unice cere oricum ca
  // registrul să țină REALLY everything.
  { name: 'apeleaza_user', category: 'diverse', does: 'apelează alt utilizator Kelion (canal audio full-duplex cu traducere live)', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // LEGATE DAR NEÎNREGISTRATE (5 aug, ordinul „leagă tot la creier"): astea 15
  // erau OFERITE creierului și funcționale, dar lipseau din registru — deci
  // `inventarulMeu()` nu le număra și creierul „nu știa că le are" (cauza „nu am
  // unelte"). Acum sunt în sursa unică, deci intră în inventar.
  { name: 'cheama_agent', category: 'cod', does: 'deleagă o sarcină unui agent specialist (din cei 91)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'agent_nou', category: 'cod', does: 'creează un agent specialist NOU când lipsește tipul (instant, fără publicare)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'memorie_pune', category: 'memorie', does: 'scrie o cheie în memoria de proiect (persistentă)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'memorie_ia', category: 'memorie', does: 'citește o cheie din memoria de proiect', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'memorie_lista', category: 'memorie', does: 'listează memoria de proiect', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'stare_masurata', category: 'cod', does: 'observabilitatea completă măsurată (starea reală a sistemului)', chat: true, voice: false, voiceViaBrain: true, admin: true },
] as const

// EXECUȚIA NU PRESUPUNE INDEPENDENȚĂ. Modelul primește rezultatele unei runde
// împreună, dar poate cere în aceeași rundă două scrieri care se contrazic sau
// doi pași dependenți de browser. Doar citirile enumerate explicit rămân
// paralele; o capabilitate nouă sau necunoscută pornește conservator, în coada
// de efecte, până când i se demonstrează independența.
const UNELTE_CITIRE_PARALELE = new Set<string>([
  'web_search', 'get_weather', 'maps_search', 'maps_directions', 'lookup_address',
  'translate_text', 'wikipedia_lookup', 'convert_currency', 'get_time',
  'get_recent_emails', 'read_email', 'get_calendar_events', 'get_drive_files',
  'read_drive_file', 'get_tasks', 'search_contacts',
  'constructor_status', 'cerinte_lista', 'cerinta_prioritate',
  'system_health', 'server_logs', 'client_errors', 'stare_masurata',
  'list_memories', 'cauta_istoric', 'dovada_faptelor', 'get_monitor',
  'get_mouse_position', 'get_real_cost', 'list_updates', 'episoade_promo',
  'lista_tarife', 'vede_video',
  // C7 (marea verificare, 22 aug) — citiri VERIFICATE pe handler, nu pe
  // registru: youtube_search (Serper + sonde de redabilitate; screen_url e
  // doar date întoarse — cadrul de monitor se emite la locul de push, ca la
  // get_weather/maps_search de mai sus), list_notes (SELECT pe notițe),
  // memorie_ia/memorie_lista sunt citiri din memoria de proiect.
  // studioul_de_clipuri, propus tot de C7, a fost RESPINS la verificare:
  // handlerul lui scrie cadrul {scenariu} direct pe fir, iar clientul
  // salvează scenariul și re-armează butonul 🎬 (generarea pornește la
  // click-ul omului — P32) — interacțiune de browser, rămâne în coada efect.
  'youtube_search', 'list_notes', 'memorie_ia', 'memorie_lista',
])

/** Grupul de exclusivitate pentru o unealtă de chat. `undefined` înseamnă o
 *  citire explicit verificată drept independentă; orice altă unealtă împarte
 *  coada `efect` cu scrierile și interacțiunile de browser/monitor. */
export function grupaExecutieUnealta(nume: string): 'efect' | undefined {
  return UNELTE_CITIRE_PARALELE.has(nume) ? undefined : 'efect'
}

/** WHAT HE KNOWS HE HAS — his own inventory, put in the brain's head.
 *
 *  Adrian, Jul 30: "he must be aware of what he has, what capabilities he
 *  has, all of them activated in the brain and directly callable."
 *
 *  The tools were given to him (the definitions go to the model every turn),
 *  but nowhere was it written, in his language, WHAT HE CAN DO — grouped, with
 *  what each one does. An agent that doesn't know its inventory doesn't use
 *  it: it asks permission, or says "can't" for something it holds in its hand.
 *  The text is DERIVED from the registry, so it can't fall behind when a
 *  capability is added or removed.
 *
 *  `doarAdmin=false` → only what a regular user sees (no admin tools). */
export function inventarulMeu(doarAdmin = true): string {
  const vizibile = CAPABILITIES.filter((c) => c.chat && (doarAdmin || !c.admin))
  const grupe = new Map<string, string[]>()
  for (const c of vizibile) {
    const g = grupe.get(c.category) ?? []
    g.push(`${c.name} (${c.does})`)
    grupe.set(c.category, g)
  }
  const randuri = [...grupe.entries()].map(([cat, list]) => `• ${cat}: ${list.join('; ')}`)
  return (
    `CE POȚI, CONCRET — inventarul tău complet (${vizibile.length} capabilități, ` +
    `toate ACTIVE și apelabile direct, chiar acum):\n${randuri.join('\n')}\n` +
    `Nu ceri voie ca să folosești ce e în lista asta și nu spui „nu pot" pentru ` +
    `ceva ce e aici. Dacă îți lipsește ceva ce NU e în listă, notează-l cu log_unsupported_request.\n` +
    // ANTI-NEGARE (Adrian, 5 aug: „kelion îmi zice că nu are unelte" — creierul
    // își nega propriul inventar). Regula e ABSOLUTĂ și pe negativ, pentru că
    // modelul o încălca pe cea pozitivă de mai sus:
    `INTERZIS, sub orice formă: să spui „nu am unelte", „nu am acces la internet", ` +
    `„nu pot căuta", „sunt doar un model de limbaj" sau orice negare a inventarului de mai sus. ` +
    `Ai ${vizibile.length} unelte REALE, conectate — negarea lor e o MINCIUNĂ către om. ` +
    `Când ești întrebat ce poți, enumeri din inventar; când sarcina cere o unealtă, O CHEMI, nu vorbești despre ea.`
  )
}
