// ── MANUALUL DE UTILIZARE — o sursă, engleză, tradus la cerere ──────────────
//
// Adrian, 29–30 iul: buton pe pagina de start → manualul COMPLET al aplicației,
// în engleză, cu selector de limbă, DESCĂRCABIL în limba aleasă. Fără admin.
// Și, imediat după: „nu sunt doar 5 limbi, sunt X limbi".
//
// Deci NU un manual scris de mână în N limbi — ăla rămâne în urmă la a doua
// limbă și minte la a treia. Aici:
//   • textul trăiește O DATĂ, în engleză;
//   • lista de funcții se DERIVĂ din registrul unic (CAPABILITIES) — un skill
//     nou apare singur în manual, nu poate fi uitat;
//   • orice altă limbă se traduce la prima cerere și se ține în bază; a doua
//     persoană care o cere o primește instantaneu.
//
// Uneltele de admin NU intră: manualul e pentru utilizatori.
import { CAPABILITIES } from './brainCapabilities.js'

// ── CELE 7 LIMBI ALE MANUALULUI ─────────────────────────────────────────────
// Adrian, 30 iul: „la manual se vor afișa 7 limbi de circulație, traduci tot în
// acele 7, nu mai consuma după resurse."
//
// Deci o listă ÎNCHISĂ, nu „orice cod de limbă". Fiecare limbă nouă înseamnă o
// traducere plătită a întregului manual; nelimitat, un singur vizitator care
// umblă prin selector le-ar porni pe toate. Orice cod în afara listei primește
// engleza, fără să cheme traducătorul.
//
// Lista: cele șase limbi de circulație internațională + ROMÂNA. Prima variantă
// pe care am pus-o (limbile oficiale ONU: + chineză și arabă, fără italiană și
// fără română) era o alegere academică, nu una potrivită produsului — Adrian a
// întrebat pe bună dreptate „unde e ro? italiana?".
export const MANUAL_LANGS = ['en', 'fr', 'de', 'es', 'it', 'ru', 'ro'] as const

export function isManualLang(v: string): boolean {
  return (MANUAL_LANGS as readonly string[]).includes(String(v ?? '').trim().toLowerCase())
}

export interface ManualSection {
  title: string
  paragraphs: string[]
}
export interface ManualGroup {
  title: string
  /** Cheia grupei (google, vedere, browser…) — frontendul desenează pictograma
   *  potrivită. Nu trimitem SVG prin API: forma e treaba interfeței, nu a
   *  textului, iar traducerea n-are ce căuta pe un desen. */
  key: string
  items: { what: string; say: string }[]
}
export interface ManualDoc {
  lang: string
  title: string
  subtitle: string
  sections: ManualSection[]
  abilitiesTitle: string
  abilitiesIntro: string
  columnWhat: string
  columnSay: string
  groups: ManualGroup[]
  footer: string
}

const TITLE = 'Kelionai — User Manual'
const SUBTITLE = 'Everything Kelion can do for you, and how to ask for it.'

const SECTIONS: ManualSection[] = [
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
      'Kelion understands and replies in dozens of languages, spoken and written. It follows the language you use — switch mid-conversation and it switches with you.',
    ],
  },
  {
    title: 'What it sees',
    paragraphs: [
      'With the camera on, Kelion can look at you and at whatever you hold up to it — a document, a part, a screen, a label. Ask "what is this?" or "read me this" and it answers from what it actually sees, not from a guess.',
      'Kelion also recognises whether the person speaking is the account holder. If the voice or the face is not yours, it becomes careful: it will not reveal your personal data or act on your behalf without confirmation. This happens silently — there is nothing to switch on.',
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
    title: 'Credits',
    paragraphs: [
      'Kelion runs on prepaid credits. You top up from the credit pill in the top bar, and usage is drawn from your balance as you go. You can turn on automatic top-up so you are never cut off mid-conversation, and turn it off again at any time.',
    ],
  },
  {
    title: 'Privacy',
    paragraphs: [
      'Your conversations, memory, notes, voice and face data belong to your account and are never shared with another user. You can delete your account and everything in it at any time — the link is at the bottom of every page.',
    ],
  },
]

const ABILITIES_TITLE = 'Everything Kelion can do'
const ABILITIES_INTRO =
  'This list is generated from the assistant itself, so it can never fall out of date. You do not call these by name — you ask in your own words and Kelion picks the right one.'
const COL_WHAT = 'What it does'
const COL_SAY = 'Just say'
const FOOTER = 'Kelionai — kelionai.app'

const GROUP_TITLES: Record<string, string> = {
  google: 'Google, search and everyday answers',
  vedere: 'Eyes and awareness',
  afisare: 'Showing things on screen',
  memorie: 'Notes and memory',
  browser: 'Browsing the web for you',
  cod: 'Deeper thinking',
  diverse: 'Other',
}
const GROUP_ORDER = ['google', 'vedere', 'afisare', 'memorie', 'browser', 'cod', 'diverse']

/** Ce face fiecare capabilitate + o frază cu care i-o ceri, pe înțelesul unui om.
 *  Registrul spune CE EXISTĂ; aici e doar CUM SE EXPLICĂ. Paznicul din
 *  manual.test.ts pică dacă apare un skill nou fără rând aici — deci nu se poate
 *  livra o funcție nedocumentată. */
export const MANUAL_CAPS: Record<string, { what: string; say: string }> = {
  // Google + răspunsuri de zi cu zi
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

  // Ochi și ancorare
  look: { what: 'Looks through your camera at you or at what you show it', say: '"what is this part?"' },
  get_monitor: { what: 'Checks what is actually on your screen right now', say: '"what am I looking at?"' },
  get_location: { what: 'Uses your real position, not a guess', say: '"where am I?"' },

  // Afișare
  show_on_screen: { what: 'Puts a page or a map on your screen', say: '"show me that on the screen"' },
  show_document: { what: 'Puts a text or a result on your screen to read', say: '"write that out for me"' },
  run_web_app: { what: 'Builds a small page and runs it for you', say: '"make me a quick calculator"' },
  generate_image: { what: 'Draws an image from your description', say: '"draw me a red kitchen"' },
  open_app_view: { what: 'Opens a panel of the app for you', say: '"open my settings"' },
  play_avatar_gesture: { what: 'Kelion gestures while it speaks', say: 'happens on its own' },

  // Notițe și memorie
  save_note: { what: 'Saves a note for later', say: '"note the meter reading is 4471"' },
  list_notes: { what: 'Shows your notes', say: '"what notes do I have?"' },
  delete_note: { what: 'Deletes a note', say: '"delete the meter note"' },
  list_memories: { what: 'Tells you what it remembers about you', say: '"what do you remember about me?"' },
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

  // Gândire adâncă
  ask_brain: { what: 'Sends a hard question to its full reasoning brain', say: 'happens on its own when needed' },
  propose_tool: { what: 'Asks for a new ability it does not have yet', say: 'happens on its own' },

  // Altele
  log_unsupported_request: { what: 'Records something it cannot do yet, so it can be built', say: 'happens on its own' },
  set_active_role: { what: 'Switches to a role that fits your work', say: '"be my accountant for this"' },
}

/** Manualul, în engleză. Traducerea se face deasupra, în serviciul de limbi. */
export function buildManual(): ManualDoc {
  const groups: ManualGroup[] = []
  for (const g of GROUP_ORDER) {
    const items = CAPABILITIES.filter((c) => !c.admin && c.category === g)
      .map((c) => MANUAL_CAPS[c.name])
      .filter((x): x is { what: string; say: string } => x != null)
    if (items.length) groups.push({ title: GROUP_TITLES[g] ?? GROUP_TITLES.diverse, key: g, items })
  }
  return {
    lang: 'en',
    title: TITLE,
    subtitle: SUBTITLE,
    sections: SECTIONS,
    abilitiesTitle: ABILITIES_TITLE,
    abilitiesIntro: ABILITIES_INTRO,
    columnWhat: COL_WHAT,
    columnSay: COL_SAY,
    groups,
    footer: FOOTER,
  }
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Manualul ca pagină de sine stătătoare — se deschide, se tipărește, se salvează. */
export function manualHtml(d: ManualDoc): string {
  const sectiuni = d.sections
    .map((s) => `<section><h2>${esc(s.title)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`)
    .join('')
  const grupe = d.groups
    .map(
      (g) =>
        `<section><h3>${esc(g.title)}</h3><table><thead><tr><th>${esc(d.columnWhat)}</th><th>${esc(d.columnSay)}</th></tr></thead><tbody>` +
        g.items.map((i) => `<tr><td>${esc(i.what)}</td><td class="say">${esc(i.say)}</td></tr>`).join('') +
        '</tbody></table></section>',
    )
    .join('')
  return `<!doctype html><html lang="${esc(d.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font: 11pt/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16181d; background: #fff; max-width: 780px; margin: 0 auto; padding: 28px 22px; }
  h1 { font-size: 26pt; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: #5b6270; margin: 0 0 30px; font-size: 12pt; }
  h2 { font-size: 14pt; margin: 28px 0 8px; }
  h3 { font-size: 12pt; margin: 22px 0 6px; }
  p { margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 16px; }
  th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; border-bottom: 1px solid #d7dbe2; padding: 4px 10px 4px 0; }
  td { padding: 6px 10px 6px 0; border-bottom: 1px solid #eef0f4; vertical-align: top; }
  td.say { color: #3b4453; font-style: italic; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 34px; padding-top: 10px; border-top: 1px solid #d7dbe2; color: #6b7280; font-size: 9pt; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>${esc(d.title)}</h1><p class="sub">${esc(d.subtitle)}</p>
${sectiuni}
<section><h2>${esc(d.abilitiesTitle)}</h2><p>${esc(d.abilitiesIntro)}</p></section>
${grupe}
<footer>${esc(d.footer)}</footer>
</body></html>`
}
