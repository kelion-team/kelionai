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

// ── THE MANUAL'S 7 LANGUAGES ───────────────────────────────────────────────
// Adrian, Jul 30: "the manual will show 7 major languages, translate
// everything into those 7, don't spend resources beyond that."
//
// So a CLOSED list, not "any language code". Every new language means a paid
// translation of the whole manual; unbounded, a single visitor playing with
// the selector would start them all. Any code outside the list gets English,
// without calling the translator.
//
// The list: the six international circulation languages + ROMANIAN. The first
// version I put up (the UN official languages: + Chinese and Arabic, without
// Italian and without Romanian) was an academic choice, not one fit for the
// product — Adrian rightly asked "where is ro? Italian?".
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
      'Kelion understands and replies in many languages, spoken and written. It follows the language you use — switch mid-conversation and it switches with you.',
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
      'Your conversations, memory, notes, voice and face data belong to your account and are never shared with another user. You can delete your account and everything in it at any time, from your account settings.',
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
  get_monitor: { what: 'Checks what is actually on your screen right now', say: '"what am I looking at?"' },
  click_monitor: { what: 'Clicks a precise spot on your screen', say: '"click at coordinates 300 400"' },
  zoom_monitor: { what: 'Zooms in or out on your screen', say: '"zoom in on the page"' },
  get_mouse_position: { what: 'Checks the position of your mouse and what it is pointing at', say: '"where is my mouse?"' },
  goleste_monitorul: { what: 'Clears the screen — closes whatever it is showing', say: '"close the monitor"' },
  get_location: { what: 'Uses your real position, not a guess', say: '"where am I?"' },

  // Display
  show_on_screen: { what: 'Puts a page or a map on your screen', say: '"show me that on the screen"' },
  show_document: { what: 'Puts a text or a result on your screen to read', say: '"write that out for me"' },
  run_web_app: { what: 'Builds a small page and runs it for you', say: '"make me a quick calculator"' },
  generate_image: { what: 'Draws an image from your description', say: '"draw me a red kitchen"' },
  generate_video: { what: 'Makes a short video clip from your description (paid, only if enabled)', say: '"make me a video of waves at sunset"' },
  open_app_view: { what: 'Opens a panel of the app for you', say: '"open my settings"' },

  // Notes and memory
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

  // Deep thinking
  ask_brain: { what: 'Sends a hard question to its full reasoning brain', say: 'happens on its own when needed' },
  propose_tool: { what: 'Asks for a new ability it does not have yet', say: 'happens on its own' },

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
  return {
    lang: 'en',
    title: TITLE,
    subtitle: SUBTITLE,
    flow: FLOW,
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
