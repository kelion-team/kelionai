// ── THE USER MANUAL — one source, English, translated on demand ────────────
//
// Adrian, Jul 29–30: a button on the start page → the COMPLETE manual of the
// app, in English, with a language selector, DOWNLOADABLE in the chosen
// language. No admin. And immediately after: "it's not just 5 languages, it's
// X languages".
//
// So NOT a manual hand-written in N languages — that one falls behind at the
// second language and lies at the third. Here:
//   • the text lives ONCE, in English;
//   • the feature list is DERIVED from the single registry (CAPABILITIES) — a
//     new skill appears in the manual on its own, it can't be forgotten;
//   • any other language is translated on first request and kept in the
//     database; the second person asking for it gets it instantly.
//
// The admin tools do NOT enter: the manual is for users.
import { CAPABILITIES } from './brainCapabilities.js'
import { meniulDeTarife, lirePentru } from './tarife.js'
import { config } from '../config.js'

// ── THE MANUAL'S CLOSED LANGUAGE LIST (8 codes) ────────────────────────────
// Adrian, Jul 30: "the manual will show 7 major languages, translate
// everything into those 7, don't spend resources beyond that."
//
// So a CLOSED list, not "any language code". Every new language means a paid
// translation of the whole manual; unbounded, a single visitor playing with
// the selector would start them all. Any code outside the list gets English,
// without calling the translator.
//
// The list started as the six international circulation languages + ROMANIAN
// (Adrian rightly asked "where is ro? Italian?" over the academic UN pick);
// KOREAN was added later, so the closed list holds 8 codes today — the RULE
// (closed list, paid translation per entry) is what stands, not the number.
export const MANUAL_LANGS = ['en', 'fr', 'de', 'es', 'it', 'ru', 'ro', 'ko'] as const

export function isManualLang(v: string): boolean {
  return (MANUAL_LANGS as readonly string[]).includes(String(v ?? '').trim().toLowerCase())
}

export interface ManualSection {
  title: string
  paragraphs: string[]
  /** Server-authoritative visibility. Clients must still filter fail-closed. */
  audience: 'public' | 'admin'
}
type ManualSectionContent = Omit<ManualSection, 'audience'>
export interface ManualGroup {
  title: string
  /** The group's key (google, vedere, browser…) — the frontend draws the
   *  matching icon. We don't send SVG through the API: shape is the
   *  interface's job, not the text's, and translation has no business on a
   *  drawing. */
  key: string
  items: { what: string; say: string }[]
}
/** "How it works", in four steps — the diagram at the start of the manual.
 *  Adrian, Jul 30: "the manual is extremely rudimentary, I expected images,
 *  much more professional". We don't use screenshots (they go stale at every
 *  interface change and weigh as much as the whole manual); we use a drawing
 *  that explains a request's journey — and it translates, like the rest. */
export interface ManualFlow {
  title: string
  steps: {
    /** The step's icon. Emoji: not translated, needs no files, looks the same
     *  on the page, in print and in the downloaded file. */
    icon: string
    label: string
    note: string
  }[]
}
export interface ManualDoc {
  lang: string
  title: string
  subtitle: string
  flow: ManualFlow
  sections: ManualSection[]
  abilitiesTitle: string
  abilitiesIntro: string
  columnWhat: string
  columnSay: string
  groups: ManualGroup[]
  footer: string
}

const FLOW: ManualFlow = {
  title: 'How a request travels',
  steps: [
    { icon: '🗣️', label: 'You ask', note: 'Speak or type, in your own language. No commands to memorise.' },
    { icon: '👂', label: 'Kelion hears', note: 'It listens continuously, understands accents, and knows when you have finished.' },
    { icon: '🧠', label: 'It thinks and acts', note: 'One brain, with every skill on hand — mail, maps, web, images, code.' },
    { icon: '💬', label: 'It answers', note: 'Out loud, and on the monitor when there is something to show you.' },
  ],
}

/** Each capability group's icon. The key is the one from the registry. */
export const GROUP_ICONS: Record<string, string> = {
  google: '✉️',
  vedere: '👁️',
  afisare: '🖥️',
  memorie: '🧩',
  browser: '🌐',
  cod: '⚙️',
  diverse: '✨',
}

const TITLE = 'Kelionai — User Manual'
const SUBTITLE = 'Everything Kelion can do for you, and how to ask for it.'

const SECTIONS: ManualSectionContent[] = [
  {
    title: 'What Kelion is',
    paragraphs: [
      'Kelion is a live assistant with a face, a voice and eyes. You talk to it the way you would talk to a person: out loud or by typing, in your own language. It answers in the same language, and it can act — send an email, put a route on the map, read a page, remember something for later.',
      'You do not need to learn commands. There is no syntax to memorise. Say what you want in plain words — "what does my week look like?", "show me the way to the station", "remind me the boiler service is due in March" — and Kelion works out which of its abilities to use.',
    ],
  },
  {
    title: 'Talking, typing, and being understood',
    paragraphs: [
      'Everything you can do by typing, you can also do by speaking. The two are the same assistant with the same abilities — not a full version and a cut-down one. If a request needs deeper thinking than a quick spoken reply allows, Kelion quietly hands it to its full reasoning brain and comes back with the answer.',
      'Kelion understands and replies in many languages, spoken and written. It follows the language you use — switch mid-conversation and it switches with you.',
      // ADUS LA COD (registrul docs-vs-cod, lot D): VAD-ul e OPT-IN (implicit
      // microfonul trimite continuu — vocalLive.ts „OPRIT IMPLICIT"), iar gura
      // de siguranță a browserului e DOAR offline — „always spoken" era fals.
      // FĂRĂ promisiunea „interrupt mid-sentence by voice" (verificatorul D):
      // pe sesiunea Live vocea NU poate întrerupe cât Kelion vorbește (half-
      // duplex + NO_INTERRUPTION) — întrerupi TASTÂND sau cu butonul.
      // F4: fraza restrânsă la TEXT simplu — tura cu ATAȘAMENT cât Live e viu
      // merge pe canalul clasic și rămâne vizuală (TTS separat suprimat), nu vocală.
      'Kelion listens hands-free while the voice session is on. Replies in a voice session are spoken with its one live voice, and if you type a message while the voice session is active, the answer comes back in that same voice — typing also interrupts it mid-sentence when you need to cut in. (A message with an attachment is answered on screen instead.) When you are offline, your device’s own voice reads the offline answers aloud.',
    ],
  },
  {
    title: 'What it sees',
    paragraphs: [
      'When you explicitly ask a visual question and provide a camera snapshot or image, Kelion can inspect a document, part, screen or label and answer from that request. It does not continuously retain camera frames as sensor history.',
      'Camera images and voice profiles never prove identity or grant access. Account permissions come only from the authenticated session. The current product does not enrol a facial biometric profile.',
    ],
  },
  {
    title: 'Your Google account',
    paragraphs: [
      'When you connect Google, Kelion can work with your mail, calendar, tasks, contacts and Drive — read them, and on your word, write to them. It acts only when you ask. It never sends, deletes or schedules anything on its own initiative.',
    ],
  },
  {
    title: 'Memory',
    paragraphs: [
      'Kelion remembers what matters across conversations — how you like things done, what you are working on, dates you mentioned. You can ask what it remembers, and you can tell it to forget something. Your memory is yours alone: it is never mixed with another account.',
    ],
  },
  {
    title: 'Watching Kelion work',
    paragraphs: [
      // BARA DE EXECUȚIE (owner, 14 aug) — the manual must describe the app as
      // it IS: every execution turn shows its steps live on the monitor.
      'When you ask Kelion to actually do something, the work is not a black box: every step it takes appears live on the monitor behind it, with a dotted progress bar filling from 0 to 100%. The bar reaches 100% only when the turn has truly finished — it never claims "done" in advance.',
      // (Paragraful despre push-ul „🔔 Pe telefon" a fost SCOS din manualul de
      // UTILIZATORI — verificatorul lotului D: butonul trăiește DOAR în
      // AdminPanel, iar regula proprie a manualului (linia ~16) spune că
      // uneltele de admin NU intră aici. Descriea un control inexistent pentru
      // cititorul lui.)
    ],
  },
  {
    title: 'When you lose signal — the companion mode',
    paragraphs: [
      'Offline mode is optional and must first be installed explicitly from Settings on a compatible device. The app performs a capability and storage preflight before downloading the local kit; it never installs a large model silently.',
      'With no network, language, transcription and speech run only on the device from the installed kit. The offline assistant cannot reach the server, Google, web search, stored account memory or online tools, and it does not invent live results.',
      'Offline turns carry stable request identifiers. After reconnection, only acknowledged turns are removed from the local queue, so a retry does not duplicate stored history or external effects.',
    ],
  },
  {
    title: 'Credits',
    paragraphs: [
      // „never cut off" era mai tare decât codul (verificatorul D): bifarea doar
      // PREGĂTEȘTE plata (linkul Revolut nu poate trage bani singur) — omul tot
      // apasă plata, deci poate fi tăiat. Spus cum E.
      'Kelion runs on prepaid credits. You top up from the credit pill in the top bar, and usage is drawn from your balance as you go. An optional low-credit reminder can prompt you to open a hosted checkout; it never charges you automatically.',
      // GUSTAREA GRATIS (owner, 14 aug): the taster exists — the manual says so.
      'Your first visit comes with a small welcome credit, on the house, so you can try Kelion before paying anything. It is granted once per account.',
    ],
  },
  {
    title: 'Price menu',
    paragraphs: [
      // MENIUL DE PREȚURI (owner, 14 aug: „meniu de prețuri regăsite și în
      // manual"). Rândurile cu cifre se generează din services/tarife.ts în
      // buildManual() — o singură sursă, manualul nu poate diverge de taxare.
      'Everyday conversation, mail, calendar, files, maps, search and video playback are included in your normal credit usage. The services below have a fixed price per use, shown before you confirm and drawn from your credits. If a paid generation fails, the credits come straight back.',
    ],
  },
  {
    title: 'Privacy',
    paragraphs: [
      'Your conversations, memories, notes and consent-based sensor data belong to your account and are isolated from other users. Account settings provide authenticated self-service deletion. The receipt identifies data erased and any legally required financial records retained in pseudonymised form until their stated expiry.',
    ],
  }, {
    title: 'Your data and continuity',
    paragraphs: [
      'Kelion keeps your account data on the application server so that conversations, memory and credits survive restarts. You can always ask Kelion in chat what it remembers about you, and you can ask it to forget a specific memory when that skill is available to your account.',
      'The service also keeps encrypted technical backups of the database on a schedule, so the platform can recover after a failure. Those backups are operational infrastructure: they are not a public download folder, and other users cannot see your data through them. Only the site owner can run restore procedures.',
      `If something looks wrong with your balance, history or login, say so in chat or write to ${config.product.supportEmail}. You do not need special commands — plain language is enough.`,
    ],
  }
]

const ABILITIES_TITLE = 'Everything Kelion can do'
const ABILITIES_INTRO =
  'This list is generated from the assistant itself, so it can never fall out of date. You do not call these by name — you ask in your own words and Kelion picks the right one.'
const COL_WHAT = 'What it does'
const COL_SAY = 'Just say'
const FOOTER = `${config.product.appName} — ${new URL(config.publicOrigin).hostname}`

const GROUP_TITLES: Record<string, string> = {
  google: 'Google, search and everyday answers',
  vedere: 'Eyes and awareness',
  auz: 'Hearing and ambient sound',
  emotie: 'Emotional awareness',
  afisare: 'Showing things on screen',
  memorie: 'Notes and memory',
  browser: 'Browsing the web for you',
  cod: 'Deeper thinking',
  diverse: 'Other',
}
const GROUP_ORDER = ['google', 'vedere', 'auz', 'emotie', 'afisare', 'memorie', 'browser', 'cod', 'diverse']

/** What each capability does + a phrase you'd ask for it with, in plain human
 *  terms. The registry says WHAT EXISTS; here is only HOW IT'S EXPLAINED. The
 *  guard in manual.test.ts fails if a new skill appears without a row here —
 *  so an undocumented feature cannot ship. */
export const MANUAL_CAPS: Record<string, { what: string; say: string }> = {
  // Google + everyday answers
  get_recent_emails: { what: 'Reads the headers of your latest emails', say: '"anything new in my inbox?"' },
  read_email: { what: 'Opens one email and reads the whole body', say: '"read me the one from the bank"' },
  send_email: { what: 'Writes and sends an email for you', say: '"email Ana that I\'ll be late"' },
  get_calendar_events: { what: 'Looks at your calendar', say: '"what does my Thursday look like?"' },
  create_calendar_event: { what: 'Puts an appointment in your calendar', say: '"book the dentist Friday at 3"' },
  delete_calendar_event: { what: 'Removes an appointment', say: '"cancel the Friday dentist"' },
  get_tasks: { what: 'Reads your task list', say: '"what\'s on my list?"' },
  add_task: { what: 'Adds a task', say: '"add: renew the insurance"' },
  complete_task: { what: 'Ticks a task off', say: '"mark the insurance one done"' },
  get_drive_files: { what: 'Lists your Drive files', say: '"what files do I have about the house?"' },
  read_drive_file: { what: 'Opens a Drive file and reads it', say: '"read me the tenancy agreement"' },
  create_doc: { what: 'Writes a new Google Doc for you', say: '"make a doc with the shopping list"' },
  create_presentation: { what: 'Builds a Google Slides presentation on your topic (paid extra, see Price menu)', say: '"make me a presentation about solar energy"' },
  create_form: { what: 'Creates a Google Form with your questions', say: '"make a sign-up form for the event"' },
  photos_alege: { what: 'Lets you pick photos from your Google Photos (you choose in Google, privately)', say: '"let me pick some photos from my Google Photos"' },
  photos_adu: { what: 'Brings the photos you picked onto the monitor', say: '"show the photos I picked"' },
  youtube_urca: { what: 'Uploads a clip made here to your own YouTube channel (private until you publish it)', say: '"upload this clip to my YouTube"' },
  business_vezi: { what: 'Reads your Google Business Profile — the account and its locations (separate one-time consent; Google must first approve API access for this project)', say: '"show my firm\'s Google listing"' },
  edit_doc: { what: 'Adds to or rewrites one of your Google Docs', say: '"add a paragraph to the meeting notes"' },
  create_sheet: { what: 'Makes a new Google Sheet from your data', say: '"put these numbers in a spreadsheet"' },
  edit_sheet: { what: 'Appends rows or fills cells in one of your sheets', say: '"add this row to the expenses sheet"' },
  search_contacts: { what: 'Finds someone in your contacts', say: '"what\'s Ana\'s number?"' },
  add_contact: { what: 'Saves a new contact', say: '"save this number as the plumber"' },
  web_search: { what: 'Searches the web and reads the results', say: '"what happened with the interest rates?"' },
  youtube_search: { what: 'Finds a video and plays it on your screen', say: '"play me something calm"' },
  get_weather: { what: 'The weather where you actually are', say: '"do I need a coat?"' },
  maps_search: { what: 'Finds places on the map', say: '"a pharmacy open now near me"' },
  maps_directions: { what: 'Puts a route on the map', say: '"how do I get to the station?"' },
  translate_text: { what: 'Translates text between languages', say: '"how do I say this in Spanish?"' },
  wikipedia_lookup: { what: 'Looks something up and explains it', say: '"who built this bridge?"' },
  convert_currency: { what: 'Converts between currencies at today\'s rate', say: '"how much is 200 euro in pounds?"' },
  get_time: { what: 'The time and date where you are', say: '"what time is it in Tokyo?"' },
  lookup_address: { what: 'Turns your coordinates into an address and postcode, or the other way round', say: '"what\'s the postcode here?"' },

  // Eyes and grounding
  look: { what: 'Looks through your camera at you or at what you show it', say: '"what is this part?"' },
  evenimente_sonore: { what: 'Shows coarse, inconclusive FFT hints (sudden noise / possible conversation or music), never a confirmed source or emergency', say: '"was there a possible sound change?"' },
  get_monitor: { what: 'Checks what is actually on your screen right now', say: '"what am I looking at?"' },
  click_monitor: { what: 'Clicks a precise spot on your screen', say: '"click at coordinates 300 400"' },
  zoom_monitor: { what: 'Zooms in or out on your screen', say: '"zoom in on the page"' },
  get_mouse_position: { what: 'Checks the position of your mouse and what it is pointing at', say: '"where is my mouse?"' },
  arata_pe_grafic: { what: 'Draws pointers on your trading chart to show exactly what he means', say: '"mark the resistance on the chart"' },
  goleste_monitorul: { what: 'Clears the screen — closes whatever it is showing', say: '"close the monitor"' },
  get_location: { what: 'Uses your real position, not a guess', say: '"where am I?"' },

  // Display
  show_on_screen: { what: 'Puts a page or a map on your screen', say: '"show me that on the screen"' },
  show_document: { what: 'Puts a text or a result on your screen to read', say: '"write that out for me"' },
  run_web_app: { what: 'Builds a small page and runs it for you', say: '"make me a quick calculator"' },
  generate_image: { what: 'Draws an image from your description', say: '"draw me a red kitchen"' },
  generate_video: { what: 'Makes a short video clip from your description (paid, only if enabled)', say: '"make me a video of waves at sunset"' },
  lista_tarife: { what: 'Reads the live price list of extra services (the price you are told is the price charged)', say: '"how much does a video clip cost?"' },
  studioul_de_clipuri: { what: 'The Clip Studio: give it an idea and it prepares an OpenAI video plan, tariff confirmation and prompt', say: '"use the Clip Studio: an ad for my bakery"' },
  vede_video: { what: 'Watches a YouTube video for you and pulls out the main ideas, facts and key moments (then remembers them)', say: '"watch this video and tell me the main ideas: <link>"' },
  open_app_view: { what: 'Opens a panel of the app for you', say: '"open my settings"' },
  proceseaza_date: { what: 'Reads a CSV/JSON you paste and works out totals, averages or a summary, shown on your screen', say: '"add up this CSV by region"' },

  // Notes and memory
  save_note: { what: 'Saves a note for later', say: '"note the meter reading is 4471"' },
  list_notes: { what: 'Shows your notes', say: '"what notes do I have?"' },
  delete_note: { what: 'Deletes a note', say: '"delete the meter note"' },
  list_memories: { what: 'Tells you what it remembers about you', say: '"what do you remember about me?"' },
  cauta_istoric: { what: 'Searches your full past chat history with it', say: '"what did we talk about last week?"' },
  apeleaza_user: { what: 'Calls another Kelion user — a live audio channel with translation between your languages', say: '"call Maria"' },
  dovada_faptelor: { what: 'Shows the saved record of what it actually did for you — each task with its measured outcome', say: '"show me proof you sent that email"' },
  forget_memory: { what: 'Forgets something on request', say: '"forget what I said about the car"' },

  // Browser
  browser_open: { what: 'Opens a website and shows it to you', say: '"open the council website"' },
  browser_click: { what: 'Clicks something on the page', say: '"click Accept"' },
  browser_type: { what: 'Fills in a field for you', say: '"type my postcode there"' },
  browser_read: { what: 'Reads the page out to you', say: '"what does it say?"' },
  browser_back: { what: 'Goes back a page', say: '"go back"' },
  browser_scroll: { what: 'Scrolls the page', say: '"scroll down a bit"' },
  browser_close: { what: 'Closes the browser', say: '"close that"' },
  browser_key: { what: 'Presses a key for you', say: '"press Enter"' },
  browser_click_at: { what: 'Clicks a precise spot you point at', say: '"click that button top right"' },

  // Deep thinking
  ask_brain: { what: 'Sends a hard question to its full reasoning brain', say: 'happens on its own when needed' },

  // Other
  log_unsupported_request: { what: 'Records something it cannot do yet, so it can be built', say: 'happens on its own' },
  set_active_role: { what: 'Switches to a role that fits your work', say: '"be my accountant for this"' },
}

/** The manual, in English. Translation happens on top, in the language service. */
export function buildManual(): ManualDoc {
  const groups: ManualGroup[] = []
  for (const g of GROUP_ORDER) {
    const items = CAPABILITIES.filter((c) => !c.admin && c.category === g)
      .map((c) => MANUAL_CAPS[c.name])
      .filter((x): x is { what: string; say: string } => x != null)
    if (items.length) groups.push({ title: GROUP_TITLES[g] ?? GROUP_TITLES.diverse, key: g, items })
  }
  // MENIUL DE PREȚURI, VIU (owner, 14 aug): rândurile cu cifre intră în
  // secțiunea „Price menu" DIN sursa taxării (tarife.ts) la fiecare build —
  // manualul arată exact prețurile care se încasează, cu profit cu tot.
  const sections: ManualSection[] = SECTIONS.map((s) =>
    s.title === 'Price menu'
      ? {
          ...s,
          audience: 'public',
          paragraphs: [
            ...s.paragraphs,
            ...meniulDeTarife().map(
              (t) => `${t.eticheta}: ${t.credite} ${t.credite === 1 ? 'credit' : 'credits'} (£${(lirePentru(t.cheie) ?? 0).toFixed(2)})`,
            ),
          ],
        }
      : { ...s, audience: 'public' },
  )
  return {
    lang: 'en',
    title: TITLE,
    subtitle: SUBTITLE,
    flow: FLOW,
    sections,
    abilitiesTitle: ABILITIES_TITLE,
    abilitiesIntro: ABILITIES_INTRO,
    columnWhat: COL_WHAT,
    columnSay: COL_SAY,
    groups,
    footer: FOOTER,
  }
}

// ── CAPITOLELE DOAR-ADMIN ALE MANUALULUI (owner, 20 aug 2026) ────────────────
// Owner: „ce e admin se afișează tot, ce nu e admin doar ce trebuie" + „nu sunt
// adeptul butoanelor". Un SINGUR manual: non-adminul vede cartea de utilizator;
// adminul o vede pe aceeași PLUS capitolele de mai jos, care apar SINGURE (fără
// buton) fiindcă ruta știe din sesiune că e admin. Aici trăiește, VIZIBIL în
// aplicație, munca de colaborare bătută în cuie cu owner-ul (proiectul de chat
// voce „Jarvis"). Textul întreg, canonic: `PROIECT-CHAT-VOCE.md`. E în ROMÂNĂ și
// se adaugă DUPĂ traducere (nu trece prin traducător) — adminul = owner-ul.
export function buildAdminChapters(): ManualSection[] {
  const userSharePercent = config.billing.userShareBps / 100
  const marginSharePercent = config.billing.marginShareBps / 100
  return [
    {
      title: '🔒 Doar admin — Voce live și orchestrare',
      audience: 'admin',
      paragraphs: [
        'Vocea live folosește OpenAI Realtime și aceeași identitate, memorie și politică de unelte ca chatul. O unealtă globală sau administrativă nu este oferită unui client obișnuit.',
        'Imaginile sunt instantanee cerute explicit, nu video continuu. Rezultatul unei unelte și meteringul poartă aceeași cheie idempotentă pentru a preveni repetarea efectelor la reconectare.',
        'Pauza, întreruperea și erorile sunt stări vizibile ale protocolului; ruta nu pretinde că o tură a reușit dacă furnizorul sau evidența durabilă a eșuat.',
      ],
    },
    {
      title: '🔒 Doar admin — Autoritate și contabilitate',
      audience: 'admin',
      paragraphs: [
        'Autoritatea de admin vine exclusiv din identitatea Google verificată și emailul configurat pe server. Roluri din baza de date, biometria, headerele și răspunsul modelului nu pot acorda privilegii.',
        'Toate capabilitățile Kelion au debit de produs exact zero pentru admin. Consumul real OpenAI rămâne măsurat separat ca cheltuială internă și nu este ascuns ori amestecat cu portofelul.',
        `Pentru clienți, alimentările eligibile sunt contabilizate în penny întregi cu split exact ${userSharePercent}% credit și ${marginSharePercent}% marjă. Costurile furnizorului folosesc separat USD micros.`,
      ],
    },
    {
      title: '🔒 Doar admin — Constructor și publicare',
      audience: 'admin',
      paragraphs: [
        'Web-ul validează și pune ordine în coadă; nu deține worktree, shell, credentiale Git sau tokenuri Codex. Workerul separat se autentifică prin clientul oficial codex login.',
        'Un job are lease, heartbeat, progres și rezultate durabile. Executorul nu poate declara singur publicarea sau deploy-ul, iar un browser admin citește numai starea autorizată.',
        'Fluxul verificabil este job, worktree izolat, codex exec, porți, PR, îmbinare și deploy separat cu backup și readiness.',
      ],
    },
    {
      title: '🔒 Doar admin — Offline și limite',
      audience: 'admin',
      paragraphs: [
        'Kitul offline este local, explicit și opțional. Instalarea pornește numai din Settings după preflight; modelele locale nu primesc chei și nu sunt folosite drept alternativă cloud a serverului.',
        'Fără rețea nu există acces la Google, memoria serverului, browser sau date live. Coada locală se sincronizează numai după autentificare și confirmă identificatorii acceptați, fără coordonate persistate implicit.',
        'Separat, decis: Constructorul aplicației folosește Codex prin autentificarea oficială ChatGPT a adminului. Funcțiile runtime ale aplicației folosesc proiectul OpenAI API separat; abonamentul ChatGPT nu este transformat într-o cheie API.',
      ],
    },
  ]
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The manual as a standalone page — it opens, it prints, it saves. */
export function manualHtml(d: ManualDoc): string {
  // We number the sections: a manual without chapter numbers and without a
  // table of contents can't be browsed, however good the text (Adrian:
  // "extremely rudimentary").
  const sectiuni = d.sections
    .map(
      (s, i) =>
        `<section id="s${i}"><h2><span class="nr">${i + 1}</span>${esc(s.title)}</h2>${s.paragraphs
          .map((p) => `<p>${esc(p)}</p>`)
          .join('')}</section>`,
    )
    .join('')
  const pasi = d.flow.steps
    .map(
      (p, i) =>
        `<li><span class="pas-nr">${i + 1}</span><span class="pas-ic" aria-hidden="true">${esc(p.icon)}</span>` +
        `<strong>${esc(p.label)}</strong><span>${esc(p.note)}</span></li>`,
    )
    .join('')
  const flux = `<section class="flux"><h2><span class="nr">•</span>${esc(d.flow.title)}</h2><ol class="pasi">${pasi}</ol></section>`
  const grupe = d.groups
    .map(
      (g, i) =>
        `<section id="g${i}"><h3><span class="ic" aria-hidden="true">${esc(GROUP_ICONS[g.key] ?? GROUP_ICONS.diverse)}</span>${esc(g.title)}</h3>` +
        `<table><thead><tr><th>${esc(d.columnWhat)}</th><th>${esc(d.columnSay)}</th></tr></thead><tbody>` +
        g.items.map((i2) => `<tr><td>${esc(i2.what)}</td><td class="say">${esc(i2.say)}</td></tr>`).join('') +
        '</tbody></table></section>',
    )
    .join('')
  const cuprins =
    '<nav class="cuprins"><ol>' +
    d.sections.map((s, i) => `<li><a href="#s${i}">${esc(s.title)}</a></li>`).join('') +
    `<li><a href="#abilitati">${esc(d.abilitiesTitle)}</a><ol>` +
    d.groups
      .map(
        (g, i) =>
          `<li><a href="#g${i}"><span class="ic" aria-hidden="true">${esc(GROUP_ICONS[g.key] ?? GROUP_ICONS.diverse)}</span>${esc(g.title)}</a></li>`,
      )
      .join('') +
    '</ol></li></ol></nav>'
  return `<!doctype html><html lang="${esc(d.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font: 11pt/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16181d; background: #fff; max-width: 780px; margin: 0 auto; padding: 28px 22px; }
  /* THE COVER — its own page when printed, like a real book. */
  .coperta { min-height: 62vh; display: flex; flex-direction: column; justify-content: center; border-bottom: 3px solid #16181d; padding-bottom: 26px; margin-bottom: 30px; }
  .marca { font-size: 34pt; line-height: 1; margin-bottom: 14px; }
  h1 { font-size: 30pt; margin: 0 0 6px; letter-spacing: -0.02em; }
  .sub { color: #5b6270; margin: 0; font-size: 13pt; max-width: 34em; }
  h2 { font-size: 15pt; margin: 30px 0 8px; display: flex; align-items: baseline; gap: 10px; }
  h2 .nr { display: inline-flex; align-items: center; justify-content: center; min-width: 1.7em; height: 1.7em; border-radius: 999px; background: #16181d; color: #fff; font-size: 9pt; flex: none; }
  h3 { font-size: 12.5pt; margin: 24px 0 6px; display: flex; align-items: center; gap: 8px; }
  .ic { font-size: 14pt; }
  p { margin: 0 0 10px; }
  /* TABLE OF CONTENTS */
  .cuprins { margin: 0 0 34px; padding: 16px 18px; background: #f6f7f9; border-radius: 10px; page-break-after: always; }
  .cuprins ol { margin: 0; padding-left: 1.3em; }
  .cuprins ol ol { padding-left: 1.1em; margin: 4px 0 0; }
  .cuprins li { margin: 3px 0; }
  .cuprins a { color: #16181d; text-decoration: none; }
  .cuprins a:hover { text-decoration: underline; }
  /* THE "how a request travels" DIAGRAM */
  .pasi { list-style: none; margin: 10px 0 6px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .pasi li { position: relative; padding: 14px 14px 14px 14px; border: 1px solid #d7dbe2; border-radius: 10px; background: #fbfcfd; display: flex; flex-direction: column; gap: 4px; page-break-inside: avoid; }
  .pas-nr { position: absolute; top: -9px; left: 12px; background: #16181d; color: #fff; font-size: 8pt; width: 18px; height: 18px; border-radius: 999px; display: flex; align-items: center; justify-content: center; }
  .pas-ic { font-size: 20pt; line-height: 1; }
  .pasi strong { font-size: 11pt; }
  .pasi span:last-child { color: #5b6270; font-size: 9.5pt; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 16px; }
  th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; border-bottom: 1px solid #d7dbe2; padding: 4px 10px 4px 0; }
  td { padding: 6px 10px 6px 0; border-bottom: 1px solid #eef0f4; vertical-align: top; }
  td.say { color: #3b4453; font-style: italic; }
  tr { page-break-inside: avoid; }
  section { page-break-inside: avoid; }
  footer { margin-top: 34px; padding-top: 10px; border-top: 1px solid #d7dbe2; color: #6b7280; font-size: 9pt; }
  @media print { body { padding: 0; } .coperta { min-height: 0; page-break-after: always; } }
</style></head><body>
<header class="coperta"><div class="marca" aria-hidden="true">🜂</div><h1>${esc(d.title)}</h1><p class="sub">${esc(d.subtitle)}</p></header>
${cuprins}
${flux}
${sectiuni}
<section id="abilitati"><h2><span class="nr">${d.sections.length + 1}</span>${esc(d.abilitiesTitle)}</h2><p>${esc(d.abilitiesIntro)}</p></section>
${grupe}
<footer>${esc(d.footer)}</footer>
</body></html>`
}
