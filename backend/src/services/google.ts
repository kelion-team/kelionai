import type { Tool } from './brain-types.js'
import { config } from '../config.js'

// Google skills exposed to the brain as tools. The brain decides when to call them;
// the backend executes the Google REST API with the user's OAuth access token
// and returns the result. Add a new skill = add a tool def + a case in
// runGoogleTool (generic framework — cheap to extend to Drive, Maps, etc.).

// Every external fetch gets a hard timeout so a slow or hung upstream (Google,
// Serper, OpenStreetMap, FX…) can NEVER block a tool call — and therefore a
// whole chat turn — forever. Respects a caller's own AbortSignal if one is
// already set (route computation, geocoding already pass their own).
async function tfetch(url: string | URL, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  if (init.signal) return fetch(url, init)
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
}

export const googleTools: Tool[] = [
  {
    name: 'get_calendar_events',
    description:
      "List the user's upcoming Google Calendar events. Use for questions about their schedule, agenda, meetings, or what is coming up.",
    input_schema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'How many events to return (default 10).' },
      },
    },
  },
  {
    name: 'get_recent_emails',
    description:
      "List the user's recent Gmail messages (sender, subject, date, snippet). Use for questions about their inbox or recent/unread email.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional Gmail search, e.g. "is:unread".' },
        max_results: { type: 'number', description: 'How many messages (default 5, max 10).' },
      },
    },
  },
  {
    name: 'read_email',
    description:
      "Read the FULL BODY of one Gmail message — the best match for a search. Use when the user wants to know what an email actually SAYS (not just the subject list from get_recent_emails): 'read me the email from X', 'what does the message about Y say'. Pass a Gmail search in `query` (e.g. from:john, subject:invoice, is:unread). Returns sender, subject, date and the full text.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search to pick the message, e.g. "from:john subject:invoice".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the live web for current, real information (news, facts, prices, anything recent). Use it whenever the answer depends on up-to-date or external information you do not already know. The engine (source:"serper") returns not just result snippets but also a direct answer, a knowledge-graph fact box, "people also ask" questions, fresh news, and related searches. On error:"search_unavailable" the search engine failed — admit you could not search, never invent results.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max_results: { type: 'number', description: 'How many organic results (default 8, max 12).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather',
    description:
      'Get the current weather and a short multi-day forecast. For a named place pass "location"; for the user\'s current location ("here"/"near me") pass their device "lat" and "lon" (given in your context) instead — that always resolves.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name, e.g. "Bucharest" or "Witney, UK".' },
        lat: { type: 'number', description: 'Latitude (use the device GPS for local weather).' },
        lon: { type: 'number', description: 'Longitude (use the device GPS for local weather).' },
      },
    },
  },
  {
    name: 'send_email',
    description:
      "Send an email from the user's Gmail account. Always include a clear subject. Confirm the recipient and content with the user before sending if there is any doubt.",
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line (concise, relevant).' },
        body: {
          type: 'string',
          description:
            'A properly structured, business-appropriate email — NOT one unformatted blob and NOT written like speech. Use real line breaks (\\n): a greeting line (e.g. "Bună ziua," / "Dear ..."), then the message in clear short paragraphs separated by a blank line, then a courteous closing (e.g. "Cu stimă," / "Kind regards,") and the sender\'s name on the next line. Match the user\'s language.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'create_calendar_event',
    description:
      "Create an event in the user's Google Calendar. Times must be ISO 8601 (e.g. 2026-07-02T15:00:00). If no end is given, a 1-hour event is created. Set meet=true when the user wants a video meeting — the event gets a Google Meet link, returned as meetLink.",
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title.' },
        start: { type: 'string', description: 'Start datetime, ISO 8601.' },
        end: { type: 'string', description: 'End datetime, ISO 8601 (optional).' },
        location: { type: 'string', description: 'Location (optional).' },
        meet: { type: 'boolean', description: 'true = attach a Google Meet video link to the event.' },
      },
      required: ['summary', 'start'],
    },
  },
  {
    name: 'create_presentation',
    description:
      'Create a Google Slides presentation in the user\'s account: a title plus a list of slides (each with a title and body text). Use when the user asks for a presentation, a deck, or slides on a topic — write the content yourself, well structured. Returns the edit URL. This is a PAID extra service (charged from the user\'s credits automatically — do not charge or refuse yourself).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Presentation title.' },
        slides: {
          type: 'array',
          description: 'The slides, in order. Keep each body concise (bullet-style lines).',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Slide title.' },
              body: { type: 'string', description: 'Slide body text (newline-separated points).' },
            },
          },
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_form',
    description:
      "Create a Google Form in the user's account: a title, an optional description and a list of text questions. Use for sign-up forms, surveys, questionnaires. Returns the link to fill it in (url) and the edit link (editUrl).",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Form title.' },
        description: { type: 'string', description: 'Optional form description.' },
        questions: { type: 'array', items: { type: 'string' }, description: 'The questions, in order (short text answers).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_calendar_event',
    description:
      "Delete an event from the user's Google Calendar. First call get_calendar_events to get the event's `id`, then pass it here. Use for 'cancel my 3pm', 'delete the meeting with X'. Confirm which event if there is any ambiguity.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The calendar event id (from get_calendar_events).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_drive_files',
    description:
      "Search or list the user's Google Drive files. Use for questions about their documents, files, or to find something on Drive.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional name search, e.g. "budget".' },
        max_results: { type: 'number', description: 'How many files (default 10, max 25).' },
      },
    },
  },
  {
    name: 'read_drive_file',
    description:
      "Read the CONTENT of one Google Drive file — the best match for a name search. Use when the user wants what a document SAYS, not just the file list: 'read me the doc about X', 'what's in the budget sheet'. Google Docs and Sheets are exported to text; text files are read directly; binary files (pdf/images) return a link instead.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name search to pick the file, e.g. "budget 2026".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_doc',
    description:
      "Create a NEW Google Doc in the user's Drive, with a title and optional text content. Use when the user asks you to WRITE something into a document, draft a doc, or save text as a Google Doc. Returns the document link. (Writing needs the Docs scope — if the user connected Google before this feature, they'll be asked to reconnect once.)",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the new document.' },
        content: { type: 'string', description: 'Optional initial text content.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'edit_doc',
    description:
      "Edit an EXISTING Google Doc (found by name). mode 'adauga' appends text at the end; 'inlocuieste' replaces the whole body with new text; 'gaseste_inlocuieste' replaces every occurrence of `find` with `replace`. Use when the user wants to add to, rewrite, or find-and-replace inside one of their docs.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name search to pick the doc, e.g. "meeting notes".' },
        mode: { type: 'string', enum: ['adauga', 'inlocuieste', 'gaseste_inlocuieste'], description: 'adauga=append, inlocuieste=replace all body, gaseste_inlocuieste=find & replace. Default adauga.' },
        text: { type: 'string', description: 'Text to append (adauga) or the new body (inlocuieste).' },
        find: { type: 'string', description: 'For gaseste_inlocuieste: the text to find.' },
        replace: { type: 'string', description: 'For gaseste_inlocuieste: the replacement text.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_sheet',
    description:
      "Create a NEW Google Sheet in the user's Drive, with a title and optional rows. `rows` is a 2D array (array of rows, each row an array of cells) — the first row is usually the header. Use when the user asks you to make a spreadsheet or table in Sheets. Returns the sheet link.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the new spreadsheet.' },
        rows: { type: 'array', items: { type: 'array', items: {} }, description: 'Optional initial data: array of rows, each row an array of cell values.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'edit_sheet',
    description:
      "Add data to an EXISTING Google Sheet (found by name). mode 'adauga' appends `rows` after the last used row; 'scrie' writes `rows` starting at `range` (e.g. \"A1\" or \"Sheet1!B2\"). `rows` is a 2D array. Use when the user wants to append records to, or overwrite a region of, one of their spreadsheets.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name search to pick the spreadsheet.' },
        mode: { type: 'string', enum: ['adauga', 'scrie'], description: 'adauga=append rows at the end, scrie=write starting at `range`. Default adauga.' },
        rows: { type: 'array', items: { type: 'array', items: {} }, description: 'Array of rows, each row an array of cell values.' },
        range: { type: 'string', description: 'For scrie: A1-style start cell/range, e.g. "A1" or "Sheet1!B2".' },
      },
      required: ['query', 'rows'],
    },
  },
  {
    name: 'get_tasks',
    description: "List the user's Google Tasks (to-dos). Use for questions about their tasks or to-do list.",
    input_schema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'How many tasks (default 20).' },
      },
    },
  },
  {
    name: 'add_task',
    description: "Add a new task to the user's Google Tasks (to-do list).",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The task text.' },
        due: { type: 'string', description: 'Optional due date, ISO 8601 (e.g. 2026-07-05).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description:
      "Mark a Google Task as done. First call get_tasks to get the task's `id`, then pass it here. Use for 'mark X as done', 'I finished Y'.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id (from get_tasks).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_contacts',
    description: "Search the user's Google Contacts by name. Returns names, emails and phone numbers.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name to search for.' },
        max_results: { type: 'number', description: 'How many contacts (default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_contact',
    description: "Add a new contact to the user's Google Contacts.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The contact's full name." },
        email: { type: 'string', description: "Optional email address." },
        phone: { type: 'string', description: "Optional phone number." },
      },
      required: ['name'],
    },
  },
  {
    name: 'maps_search',
    description:
      'Find ONE place, address or point of interest and show it on the monitor map with a marker. Use for "where is X", addresses, or locating a single place. NOT for routes or directions — anything "from A to B", "route", "directions", "how do I get to" MUST go to maps_directions, which draws the actual route on the map. ' +
      // MĂSURAT 10 aug (ownerul: „casa lui Shakespeare" → harta aiurea): Nominatim
      // potrivește NUME LITERALE de pe hartă — fraza românească întoarce NIMIC,
      // „Casa Shakespeare" întoarce o casă din BOLIVIA cu toată încrederea.
      // Contractul de mai jos e gardul: creierul știe numele canonic; geocoderul nu.
      'CANONICAL NAMES ONLY: the geocoder matches literal map names — NEVER pass a descriptive phrase in the user\'s language ("casa lui Shakespeare"), it returns nothing or a confidently WRONG place (measured: "Casa Shakespeare" → Bolivia). YOU know the canonical name — translate the request to the place\'s official name plus its town ("Shakespeare\'s Birthplace, Stratford-upon-Avon"). Then VERIFY the returned display_name really is the intended place (right town, right country); if it is not, retry once with a more specific canonical name, and if still wrong, tell the user honestly instead of showing a wrong map.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Canonical place name or address + town, e.g. "Romanian Athenaeum, Bucharest" — never a descriptive phrase in the user\'s language.' },
        max_results: { type: 'number', description: 'How many places (default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'maps_directions',
    // MĂSURAT 8 aug: cerut de 15 ori „show on map the route from Witney to
    // Rollright Stones", creierul a chemat de fiecare dată maps_search (singura
    // descriere care pomenea harta) și n-a desenat NICIODATĂ traseul. Descrierea
    // trebuie să spună că unealta ASTA pune traseul pe monitor.
    description:
      'Show the DRIVEN ROUTE between two places ON the monitor map (a live Leaflet map with the route line drawn), plus driving distance, travel time and turn-by-turn directions. This is THE tool for any route/directions/"from A to B"/"show me the way" request — never maps_search for those. ' +
      // Același gard ca la maps_search (măsurat 10 aug) — traseul cu o
      // destinație geocodată greșit e o hartă care minte frumos.
      'CANONICAL NAMES ONLY for both ends: the geocoder matches literal map names — never pass a descriptive phrase in the user\'s language ("casa lui Shakespeare" returns nothing; "Casa Shakespeare" returns Bolivia). Translate to the official place name plus its town ("Shakespeare\'s Birthplace, Stratford-upon-Avon"). For "from here"/"de aici", use the GPS coordinates injected in your context as origin ("<lat>,<lon>" works). Then CHECK the returned origin/destination display_names really are the intended places; wrong place → retry once with a more specific canonical name, still wrong → say so honestly, never draw a wrong route.',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Start: canonical place name + town, exact address, or "lat,lon" (use the context GPS for "from here").' },
        destination: { type: 'string', description: 'Destination: canonical place name + town or exact address — never a descriptive phrase in the user\'s language.' },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'lookup_address',
    description:
      'Resolve EXACT coordinates (latitude/longitude) to the real address and POSTCODE at that point (reverse geocoding). Use whenever the user gives coordinates and wants the address or postcode, or asks "what is the postcode here / of this place". For the user\'s CURRENT location, pass the GPS coordinates injected in your context (no other tool gives them — if they are not in the context, say honestly you do not have the location).',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude, e.g. 51.7859.' },
        lon: { type: 'number', description: 'Longitude, e.g. -1.4851.' },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'youtube_search',
    description: 'Search YouTube for videos. Returns titles and links.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for on YouTube.' },
        max_results: { type: 'number', description: 'How many videos (default 5, max 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'translate_text',
    description: 'Translate text into another language.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to translate.' },
        target: { type: 'string', description: 'Target language, e.g. "English", "Romanian", "French".' },
      },
      required: ['text', 'target'],
    },
  },
  {
    name: 'wikipedia_lookup',
    description:
      'Look up reliable factual / encyclopedic information about a person, place, thing, event or concept on Wikipedia. Use for "who/what/where is…" knowledge questions and to get accurate facts instead of guessing.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The topic or title to look up.' } },
      required: ['query'],
    },
  },
  {
    name: 'convert_currency',
    description:
      'Convert an amount between two currencies at the live exchange rate. Use for any money/currency conversion.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount to convert (default 1).' },
        from: { type: 'string', description: '3-letter currency code, e.g. "USD".' },
        to: { type: 'string', description: '3-letter currency code, e.g. "EUR".' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_time',
    description:
      'Get the current date and time in a given IANA timezone. Use whenever the user asks the time/date anywhere, or you need the real current time.',
    input_schema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone, e.g. "Europe/Bucharest". Defaults to UTC.',
        },
      },
    },
  },
]

// Exchange a refresh token for a fresh access token. Returns null on failure
// (e.g. the user revoked access) so the caller can fall back to asking them to
// sign in again. Google does not return a new refresh token here — we keep the
// existing one.
export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  if (!refreshToken) return null
  try {
    const res = await tfetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!j.access_token) return null
    return { accessToken: j.access_token, expiresIn: j.expires_in ?? 3600 }
  } catch {
    return null
  }
}

// Best-effort reverse geocode (device GPS → human place name + POSTCODE) so the
// brain knows where "here" is. Keyless OpenStreetMap Nominatim; short timeout,
// never throws. Cached by ~100 m (3 decimals); failures are negative-cached
// briefly so an outage can't cause a lookup storm.

/** The address fields Nominatim returns with addressdetails=1 (only what we use). */
export interface NominatimAddress {
  road?: string
  neighbourhood?: string
  suburb?: string
  village?: string
  town?: string
  city?: string
  county?: string
  postcode?: string
  country?: string
}

/** The pair Kelion needs: a SHORT human place + the postcode of the exact point. */
export interface GeoPlace {
  place: string
  postcode: string
}

/** THE COORDINATES ↔ POSTCODE PAIRING (Adrian, Aug 1: "it can't see the link
 *  from the exact coordinates and pair them with the postcode"). Pure and
 *  exported, so the rules are tested without network: the place is the short
 *  "street, settlement, county, country" form (the raw display_name is a
 *  mouthful), the postcode comes from the address parts — never guessed. */
export function composePlace(addr: NominatimAddress | undefined, displayName: string): GeoPlace {
  const postcode = (addr?.postcode ?? '').trim()
  if (!addr) return { place: displayName, postcode }
  const settlement = addr.city ?? addr.town ?? addr.village ?? addr.suburb ?? addr.neighbourhood ?? ''
  const county = addr.county && addr.county !== settlement ? addr.county : ''
  const short = [addr.road, settlement, county, addr.country].filter(Boolean).join(', ')
  return { place: short || displayName, postcode }
}

const geoCache = new Map<string, GeoPlace>()
const geoRetryAt = new Map<string, number>()

/** Structured variant (the address tool uses it): null = couldn't resolve. */
export async function reverseGeocodeInfo(lat: number, lon: number): Promise<GeoPlace | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = geoCache.get(key)
  if (hit !== undefined) return hit
  if ((geoRetryAt.get(key) ?? 0) > Date.now()) return null
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse')
    u.searchParams.set('lat', String(lat))
    u.searchParams.set('lon', String(lon))
    u.searchParams.set('format', 'json')
    // Building-level zoom + the address breakdown: below this the postcode
    // often doesn't come at all — exactly the "coordinates have no postcode"
    // gap Adrian hit.
    u.searchParams.set('zoom', '18')
    u.searchParams.set('addressdetails', '1')
    const res = await tfetch(u, {
      headers: { 'User-Agent': 'KelionAI/1.0 (kelionai.app)' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      geoRetryAt.set(key, Date.now() + 60_000)
      return null
    }
    const j = (await res.json()) as { display_name?: string; address?: NominatimAddress }
    const info = composePlace(j.address, j.display_name ?? '')
    if (!info.place) {
      geoRetryAt.set(key, Date.now() + 60_000)
      return null
    }
    geoCache.set(key, info)
    return info
  } catch {
    geoRetryAt.set(key, Date.now() + 60_000)
    return null
  }
}

// Non-blocking variant for the chat hot path: returns the cached place name
// instantly ('' when not resolved yet) and warms the cache in the background.
// The GPS place name must NEVER delay a reply — the raw lat/lon (which the
// skills use directly) is always injected regardless.
const geoInFlight = new Set<string>()

/** One place, one text: the cached info → the string the context injects. */
function placeText(info: GeoPlace): string {
  return info.postcode ? `${info.place} — postcode ${info.postcode}` : info.place
}

export function reverseGeocodeCached(lat: number, lon: number): string {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = geoCache.get(key)
  if (hit !== undefined) return placeText(hit)
  if (!geoInFlight.has(key)) {
    geoInFlight.add(key)
    void reverseGeocodeInfo(lat, lon).finally(() => geoInFlight.delete(key))
  }
  return ''
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// Small retry for flaky free APIs (e.g. Open-Meteo) so a transient hiccup doesn't
// surface to the user as "service unavailable".
async function fetchRetry(url: string | URL, tries = 3): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await tfetch(url)
      if (r.ok) return r
    } catch {
      /* network blip — retry */
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 250 * (i + 1)))
  }
  return null
}

interface CalendarItem {
  id?: string
  summary?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}
interface GmailHeader {
  name: string
  value: string
}

async function calendarEvents(max: number, token: string): Promise<string> {
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.searchParams.set('timeMin', new Date().toISOString())
  url.searchParams.set('maxResults', String(Math.min(Math.max(max, 1), 25)))
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  const res = await tfetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `calendar_http_${res.status}` })
  const j = (await res.json()) as { items?: CalendarItem[] }
  const events = (j.items ?? []).map((e) => ({
    id: e.id ?? '', // needed for delete_calendar_event
    summary: e.summary ?? '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    location: e.location ?? '',
  }))
  return JSON.stringify({ events })
}

// DELETE AN EVENT (SINGLE BRAIN §2.2). EXISTING calendar scope (the same as
// create_calendar_event) — no re-authentication. The id comes from get_calendar_events.
async function deleteCalendarEvent(id: string, token: string): Promise<string> {
  if (!id) return JSON.stringify({ error: 'missing_event_id', hint: 'Cheamă întâi get_calendar_events ca să iei id-ul.' })
  const res = await tfetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // Calendar returns 204 on a successful delete; 410 = already deleted (still success).
  if (res.status === 204 || res.status === 410) return JSON.stringify({ deleted: true, id })
  return JSON.stringify({ error: `calendar_delete_http_${res.status}` })
}

// Lists the Gmail message ids for a search (shared by get_recent_emails and
// read_email). Returns {ids} or {err} — a JSON string ready to hand back.
// Single source (the permanent principle: one, no duplicates).
async function gmailListMessageIds(
  query: string,
  max: number,
  token: string,
): Promise<{ ids: string[] } | { err: string }> {
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  listUrl.searchParams.set('maxResults', String(max))
  if (query) listUrl.searchParams.set('q', query)
  const listRes = await tfetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (!listRes.ok) return { err: JSON.stringify({ error: `gmail_http_${listRes.status}` }) }
  const list = (await listRes.json()) as { messages?: { id: string }[] }
  return { ids: (list.messages ?? []).map((m) => m.id) }
}

async function recentEmails(query: string, max: number, token: string): Promise<string> {
  const n = Math.min(Math.max(max, 1), 10)
  const listed = await gmailListMessageIds(query, n, token)
  if ('err' in listed) return listed.err
  const ids = listed.ids.slice(0, n)
  const emails: { from: string; subject: string; date: string; snippet: string }[] = []
  for (const id of ids) {
    const mUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
    const mRes = await tfetch(mUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!mRes.ok) continue
    const m = (await mRes.json()) as { snippet?: string; payload?: { headers?: GmailHeader[] } }
    const h = (name: string): string =>
      m.payload?.headers?.find((x) => x.name === name)?.value ?? ''
    emails.push({ from: h('From'), subject: h('Subject'), date: h('Date'), snippet: m.snippet ?? '' })
  }
  return JSON.stringify({ emails })
}

// THE FULL BODY OF AN EMAIL (SINGLE BRAIN §2.2): get_recent_emails gives only
// the header; this reads what the message SAYS. Uses the SAME Gmail scope (no
// re-authentication). Picks the best match for the search, extracts the body
// (prefers text/plain, otherwise cleans html), capped so it doesn't fill the
// context.
function decodeGmailB64(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return ''
  }
}
interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}
function extractGmailBody(payload: GmailPart | undefined, prefer: string): string {
  if (!payload) return ''
  if (payload.mimeType === prefer && payload.body?.data) return decodeGmailB64(payload.body.data)
  for (const p of payload.parts ?? []) {
    const r = extractGmailBody(p, prefer)
    if (r) return r
  }
  return ''
}
async function readEmail(query: string, token: string): Promise<string> {
  const listed = await gmailListMessageIds(query, 1, token)
  if ('err' in listed) return listed.err
  const id = listed.ids[0]
  if (!id) return JSON.stringify({ found: false, note: 'Niciun email pentru această căutare.' })
  const mRes = await tfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!mRes.ok) return JSON.stringify({ error: `gmail_http_${mRes.status}` })
  const m = (await mRes.json()) as { snippet?: string; payload?: GmailPart & { headers?: GmailHeader[] } }
  const h = (name: string): string => m.payload?.headers?.find((x) => x.name === name)?.value ?? ''
  let body = extractGmailBody(m.payload, 'text/plain') || extractGmailBody(m.payload, 'text/html')
  if (/<[a-z][\s\S]*>/i.test(body)) body = body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  body = body.replace(/&nbsp;/g, ' ').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000)
  return JSON.stringify({ found: true, from: h('From'), subject: h('Subject'), date: h('Date'), body: body || m.snippet || '' })
}
// ── SERPER (google.serper.dev) — the PRIMARY web search ──────────────────────
// The key existed in config (SERPER_API_KEY/SERPER_KEY) since Jul 30 but NO code
// read it — web_search went only through the OpenRouter `web` plugin, whose free
// model returns content:null (degenerate reasoning loop, live-proven Aug 2026)
// → the user always got search_unavailable while a paid Serper key sat unused.
// Serper gives REAL Google results: answerBox + knowledgeGraph + peopleAlsoAsk +
// organic links + fresh news + relatedSearches. On ANY failure (missing/invalid
// key, quota, network) we answer an honest `search_unavailable` — Serper is the
// ONLY engine (OpenRouter extirpat, 3 aug).
interface SerperHit {
  title?: string
  link?: string
  snippet?: string
  date?: string
  source?: string
}
interface SerperJson {
  answerBox?: { answer?: string; snippet?: string; title?: string; link?: string }
  knowledgeGraph?: { title?: string; type?: string; description?: string; descriptionLink?: string }
  peopleAlsoAsk?: { question?: string; snippet?: string; link?: string }[]
  relatedSearches?: { query?: string }[]
  topStories?: SerperHit[]
  news?: SerperHit[]
  organic?: SerperHit[]
}

// Exported so the shape/merge rules are testable without network (same pattern
// as composePlace above): one JSON string for the brain, never guessed fields.
export function composeSerperResult(j: SerperJson, n: number): string | null {
  const results = (j.organic ?? [])
    .filter((o) => o.link)
    .slice(0, n)
    .map((o) => ({ title: o.title ?? '', link: o.link ?? '', snippet: o.snippet ?? '' }))
  const answer = j.answerBox?.answer ?? j.answerBox?.snippet ?? ''
  if (!answer && results.length === 0) return null // empty page → let the fallback try
  const kg = j.knowledgeGraph?.title
    ? {
        title: j.knowledgeGraph.title,
        type: j.knowledgeGraph.type ?? '',
        description: j.knowledgeGraph.description ?? '',
        link: j.knowledgeGraph.descriptionLink ?? '',
      }
    : undefined
  const news = [...(j.topStories ?? []), ...(j.news ?? [])]
    .filter((s) => s.link)
    .slice(0, 5)
    .map((s) => ({ title: s.title ?? '', link: s.link ?? '', source: s.source ?? '', date: s.date ?? '' }))
  return JSON.stringify({
    answer,
    results,
    knowledge_graph: kg,
    people_also_ask: (j.peopleAlsoAsk ?? [])
      .filter((p) => p.question)
      .slice(0, 4)
      .map((p) => ({ question: p.question, answer: p.snippet ?? '', link: p.link ?? '' })),
    news,
    related_searches: (j.relatedSearches ?? []).map((r) => r.query ?? '').filter(Boolean).slice(0, 6),
    source: 'serper',
  })
}

// UN SINGUR apel Serper (jscpd, 3 aug): search și videos difereau DOAR prin
// endpoint — cererea (cheie, headere, num plafonat 1..12, timeout) e una.
async function serperPost(endpoint: 'search' | 'videos', query: string, n: number): Promise<Response> {
  return tfetch(
    `https://google.serper.dev/${endpoint}`,
    {
      method: 'POST',
      headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: Math.min(Math.max(n, 1), 12) }),
    },
    15_000,
  )
}

async function serperSearch(query: string, n: number): Promise<string | null> {
  if (!config.serperKey) return null
  try {
    const res = await serperPost('search', query, n)
    // 401/403/429 = cheie rea / fără credit → null → search_unavailable, onest.
    if (!res.ok) return null
    return composeSerperResult((await res.json()) as SerperJson, n)
  } catch {
    return null
  }
}

// YouTube videos through Serper's dedicated /videos endpoint — REAL Google video
// results (title + link), no OpenRouter dependency. Same failure contract as
// serperSearch: missing/invalid key, quota, non-ok or network → [] so
// youtube_search can honestly report "search_unavailable" instead of "no videos".
async function serperVideos(query: string, n: number): Promise<{ title: string; url: string }[]> {
  if (!config.serperKey) return []
  try {
    const res = await serperPost('videos', query, n)
    if (!res.ok) return []
    const j = (await res.json()) as { videos?: { title?: string; link?: string }[] }
    return (j.videos ?? [])
      .filter((v): v is { title?: string; link: string } => Boolean(v.link))
      .map((v) => ({ title: v.title ?? '', url: v.link }))
  } catch {
    return []
  }
}

// (composeOpenrouterFallback a fost ȘTERS aici, 3 aug — extirparea totală
// OpenRouter: nu mai există niciun fallback de căutare pe alt furnizor.
// Serper e SINGURUL motor; dacă pică, spunem cinstit `search_unavailable`.)

export async function webSearch(query: string, max: number): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const n = Math.min(Math.max(max, 1), 12)
  // SERPER ONLY (Adrian, 3 aug: OpenRouter scos TOTAL din aplicație). Serper dă
  // rezultate Google reale; dacă pică (cheie lipsă / cotă / rețea), spunem cinstit
  // că nu putem căuta acum — NU mai cădem pe pluginul web OpenRouter (eliminat).
  const viaSerper = await serperSearch(query, n)
  if (viaSerper) return viaSerper
  return JSON.stringify({ error: 'search_unavailable' })
}

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm w/ hail', 99: 'thunderstorm w/ hail',
}

async function weather(location: string, lat: number, lon: number): Promise<string> {
  // Resolve to coordinates: device GPS (always works) takes priority; otherwise
  // geocode the place name.
  let latitude = lat
  let longitude = lon
  let label = 'your location'
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    if (!location) return JSON.stringify({ error: 'empty_location' })
    // Open-Meteo's geocoder wants a bare place name, but users say "Witney,
    // Anglia" / "Paris, Frankreich" — country in THEIR language, with a comma.
    // Resolve in three steps so no phrasing ever breaks the weather: the full
    // string → the part before the comma → free-form Nominatim (any language).
    const tryOpenMeteo = async (
      name: string,
    ): Promise<{ latitude: number; longitude: number; name: string; country?: string } | null> => {
      const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
      geoUrl.searchParams.set('name', name)
      geoUrl.searchParams.set('count', '1')
      const geoRes = await fetchRetry(geoUrl)
      if (!geoRes) return null
      const geo = (await geoRes.json()) as {
        results?: { latitude: number; longitude: number; name: string; country?: string }[]
      }
      return geo.results?.[0] ?? null
    }
    let place = await tryOpenMeteo(location)
    const bare = location.split(',')[0]?.trim() ?? ''
    if (!place && bare && bare !== location) place = await tryOpenMeteo(bare)
    if (place) {
      latitude = place.latitude
      longitude = place.longitude
      label = `${place.name}${place.country ? ', ' + place.country : ''}`
    } else {
      const nom = await geocodeOne(location)
      if (!nom?.lat || !nom?.lon) return JSON.stringify({ error: 'location_not_found' })
      latitude = Number(nom.lat)
      longitude = Number(nom.lon)
      label = location
    }
  }
  const wUrl = new URL('https://api.open-meteo.com/v1/forecast')
  wUrl.searchParams.set('latitude', String(latitude))
  wUrl.searchParams.set('longitude', String(longitude))
  wUrl.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m')
  wUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code')
  wUrl.searchParams.set('forecast_days', '3')
  wUrl.searchParams.set('timezone', 'auto')
  const wRes = await fetchRetry(wUrl)
  if (!wRes) return JSON.stringify({ error: 'weather_unavailable' })
  const w = (await wRes.json()) as {
    current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number }
    daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] }
  }
  const code = (n: number): string => WEATHER_CODES[n] ?? `code ${n}`
  const c = w.current
  const forecast = (w.daily?.time ?? []).map((d, i) => ({
    date: d,
    max_c: w.daily?.temperature_2m_max?.[i],
    min_c: w.daily?.temperature_2m_min?.[i],
    condition: code(w.daily?.weather_code?.[i] ?? -1),
  }))
  // A live, embeddable weather map centred on the REAL coordinates (Windy's free
  // public embed — no API key, iframe-friendly). chat.ts shows this on the
  // monitor automatically, so Kelion never has to guess a weather website URL.
  const la = Math.round(latitude * 10000) / 10000
  const lo = Math.round(longitude * 10000) / 10000
  const screen_url =
    `https://embed.windy.com/embed2.html?lat=${la}&lon=${lo}&detailLat=${la}&detailLon=${lo}` +
    `&zoom=8&level=surface&overlay=temp&marker=true&type=map&location=coordinates&metricTemp=%C2%B0C`
  return JSON.stringify({
    location: label,
    lat: la,
    lon: lo,
    current: c
      ? { temp_c: c.temperature_2m, condition: code(c.weather_code), wind_kmh: c.wind_speed_10m, humidity_pct: c.relative_humidity_2m }
      : null,
    forecast,
    screen_url,
  })
}

async function sendEmail(to: string, subject: string, body: string, token: string): Promise<string> {
  if (!to || !body) return JSON.stringify({ error: 'missing_to_or_body' })
  // RFC 2822 message, base64url-encoded, as Gmail's send API expects.
  const headers = [`To: ${to}`, `Subject: ${subject || '(no subject)'}`, 'Content-Type: text/plain; charset="UTF-8"']
  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  const res = await tfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) return JSON.stringify({ error: `gmail_send_http_${res.status}` })
  return JSON.stringify({ sent: true, to, subject })
}

async function createCalendarEvent(
  summary: string,
  start: string,
  end: string,
  location: string,
  token: string,
  meet = false,
): Promise<string> {
  if (!summary || !start) return JSON.stringify({ error: 'missing_summary_or_start' })
  const startMs = Date.parse(start)
  if (Number.isNaN(startMs)) return JSON.stringify({ error: 'bad_start_datetime' })
  const endIso = end && !Number.isNaN(Date.parse(end))
    ? new Date(end).toISOString()
    : new Date(startMs + 3_600_000).toISOString()
  // GOOGLE MEET (owner, 14 aug: interconectarea produselor alese — Meet).
  // Cu meet=true, Calendar creează și camera de întâlnire (conferenceData) —
  // NICIUN scope nou: merge pe scope-ul calendar deja acordat.
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  if (meet) url.searchParams.set('conferenceDataVersion', '1')
  const res = await tfetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      location: location || undefined,
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: endIso },
      conferenceData: meet
        ? { createRequest: { requestId: `kelion-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
        : undefined,
    }),
  })
  if (!res.ok) return JSON.stringify({ error: `calendar_create_http_${res.status}` })
  const j = (await res.json()) as {
    htmlLink?: string
    hangoutLink?: string
    conferenceData?: { entryPoints?: { uri?: string }[] }
  }
  const meetLink = j.hangoutLink ?? j.conferenceData?.entryPoints?.[0]?.uri
  return JSON.stringify({ created: true, summary, start, link: j.htmlLink ?? '', meetLink: meet ? (meetLink ?? '') : undefined })
}

// ── GOOGLE SLIDES (owner, 14 aug: produsele alese — „vreau să le văd") ───────
// Creează prezentarea + câte un slide TITLE_AND_BODY per intrare, cu textele
// puse prin placeholderIdMappings (calea documentată — fără ghicit de id-uri).
async function createPresentation(
  title: string,
  slides: unknown,
  token: string,
): Promise<string> {
  if (!title) return JSON.stringify({ error: 'missing_title' })
  const cRes = await tfetch('https://slides.googleapis.com/v1/presentations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!cRes.ok) return JSON.stringify({ error: `slides_create_http_${cRes.status}` })
  const cj = (await cRes.json()) as { presentationId?: string }
  const id = cj.presentationId
  if (!id) return JSON.stringify({ error: 'slides_no_id' })
  const lista = (Array.isArray(slides) ? slides : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>
      return { titlu: String(o.title ?? o.titlu ?? '').slice(0, 200), corp: String(o.body ?? o.corp ?? '').slice(0, 4000) }
    })
    .filter((s) => s.titlu || s.corp)
    .slice(0, 25)
  if (lista.length) {
    const requests = lista.flatMap((s, i) => {
      const slideId = `kelion_slide_${i}`
      const titluId = `kelion_titlu_${i}`
      const corpId = `kelion_corp_${i}`
      const reqs: unknown[] = [
        {
          createSlide: {
            objectId: slideId,
            slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
            placeholderIdMappings: [
              { layoutPlaceholder: { type: 'TITLE' }, objectId: titluId },
              { layoutPlaceholder: { type: 'BODY' }, objectId: corpId },
            ],
          },
        },
      ]
      if (s.titlu) reqs.push({ insertText: { objectId: titluId, text: s.titlu } })
      if (s.corp) reqs.push({ insertText: { objectId: corpId, text: s.corp } })
      return reqs
    })
    const uRes = await tfetch(`https://slides.googleapis.com/v1/presentations/${id}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
    // Prezentarea EXISTĂ deja — un eșec la umplere se spune, nu se ascunde.
    if (!uRes.ok) {
      return JSON.stringify({
        created: true, id, url: `https://docs.google.com/presentation/d/${id}/edit`,
        avertisment: `prezentarea s-a creat, dar umplerea slide-urilor a picat (HTTP ${uRes.status}) — deschide-o și completeaz-o`,
      })
    }
  }
  return JSON.stringify({ created: true, id, slides: lista.length, url: `https://docs.google.com/presentation/d/${id}/edit` })
}

// ── GOOGLE FORMS (owner, 14 aug: produsele alese) ────────────────────────────
// Creează formularul + întrebări text simple; întoarce linkul de completat.
async function createForm(title: string, description: string, questions: unknown, token: string): Promise<string> {
  if (!title) return JSON.stringify({ error: 'missing_title' })
  const cRes = await tfetch('https://forms.googleapis.com/v1/forms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ info: { title, documentTitle: title } }),
  })
  if (!cRes.ok) return JSON.stringify({ error: `forms_create_http_${cRes.status}` })
  const cj = (await cRes.json()) as { formId?: string; responderUri?: string }
  if (!cj.formId) return JSON.stringify({ error: 'forms_no_id' })
  const intrebari = (Array.isArray(questions) ? questions : [])
    .map((q) => String(q ?? '').trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 30)
  const requests: unknown[] = []
  if (description) requests.push({ updateFormInfo: { info: { description: description.slice(0, 1000) }, updateMask: 'description' } })
  intrebari.forEach((q, i) =>
    requests.push({
      createItem: {
        item: { title: q, questionItem: { question: { required: false, textQuestion: { paragraph: false } } } },
        location: { index: i },
      },
    }),
  )
  if (requests.length) {
    const uRes = await tfetch(`https://forms.googleapis.com/v1/forms/${cj.formId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
    if (!uRes.ok) {
      return JSON.stringify({
        created: true, id: cj.formId, url: cj.responderUri ?? `https://docs.google.com/forms/d/${cj.formId}/edit`,
        avertisment: `formularul s-a creat, dar întrebările nu au intrat (HTTP ${uRes.status}) — deschide-l și completează-l`,
      })
    }
  }
  return JSON.stringify({
    created: true, id: cj.formId, intrebari: intrebari.length,
    url: cj.responderUri ?? '', editUrl: `https://docs.google.com/forms/d/${cj.formId}/edit`,
  })
}

async function driveFiles(query: string, max: number, token: string): Promise<string> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('pageSize', String(Math.min(Math.max(max, 1), 25)))
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink)')
  url.searchParams.set('orderBy', 'modifiedTime desc')
  if (query) {
    const safe = query.replaceAll("'", String.raw`\'`)
    url.searchParams.set('q', `name contains '${safe}' and trashed = false`)
  } else {
    url.searchParams.set('q', 'trashed = false')
  }
  const res = await tfetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `drive_http_${res.status}` })
  const j = (await res.json()) as {
    files?: { id?: string; name?: string; mimeType?: string; modifiedTime?: string; webViewLink?: string }[]
  }
  return JSON.stringify({ files: j.files ?? [] })
}

// READ A DRIVE FILE'S CONTENT (SINGLE BRAIN §2.2). EXISTING Drive scope (the
// same as get_drive_files) — no re-authentication. Picks the best match for
// the search; Google Docs → text export, Sheets → csv, text files → raw
// content; binaries (pdf/images) can't be read as text → link.
async function readDriveFile(query: string, token: string): Promise<string> {
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files')
  listUrl.searchParams.set('pageSize', '1')
  listUrl.searchParams.set('fields', 'files(id,name,mimeType,webViewLink)')
  listUrl.searchParams.set('orderBy', 'modifiedTime desc')
  const safe = (query || '').replaceAll("'", String.raw`\'`)
  listUrl.searchParams.set('q', safe ? `name contains '${safe}' and trashed = false` : 'trashed = false')
  const listRes = await tfetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (!listRes.ok) return JSON.stringify({ error: `drive_http_${listRes.status}` })
  const list = (await listRes.json()) as { files?: { id?: string; name?: string; mimeType?: string; webViewLink?: string }[] }
  const f = list.files?.[0]
  if (!f?.id) return JSON.stringify({ found: false, note: 'Niciun fișier pentru această căutare.' })
  const mime = f.mimeType ?? ''
  const auth = { headers: { Authorization: `Bearer ${token}` } }
  let contentUrl: string
  if (mime === 'application/vnd.google-apps.document') {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`
  } else if (mime === 'application/vnd.google-apps.spreadsheet') {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/csv`
  } else if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
    contentUrl = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`
  } else {
    return JSON.stringify({ found: true, name: f.name, mimeType: mime, note: 'Fișier binar (pdf/imagine/etc.) — nu se poate citi ca text.', link: f.webViewLink ?? '' })
  }
  const cRes = await tfetch(contentUrl, auth)
  if (!cRes.ok) return JSON.stringify({ error: `drive_read_http_${cRes.status}` })
  const text = (await cRes.text()).slice(0, 8000)
  return JSON.stringify({ found: true, name: f.name, mimeType: mime, content: text, link: f.webViewLink ?? '' })
}

// ── L1i: EDITARE AVANSATĂ GOOGLE DRIVE (Docs + Sheets) ──────────────────────
//
// Ownerul (autonomie): Kelion citea Drive, dar nu putea CREA/EDITA. Aici capătă
// mâinile: creează și modifică Google Docs (API Docs, scope `documents`) și
// Google Sheets (API Sheets, scope `spreadsheets`) în contul OMULUI logat.
// Scrierea NU merge fără scope de scriere — de-aia consimțământul cere acum și
// scope-urile astea; dacă tokenul e vechi (doar citire), API-ul dă 403 și
// dispecerul întoarce „reconectează Google" (nu un cod brut). Regula #1: ce nu
// s-a scris cu succes NU se raportează ca scris (răspunsul poartă id-ul/linkul
// REAL de la Google, nu o promisiune).

/** 2D array de valori pentru Sheets, curățat din inputul modelului. Rânduri =
 *  array de array-uri; celulele rămân string sau number (nimic altceva). Pur,
 *  ca să-l putem proba fără rețea. */
export function normalizeazaRanduri(input: unknown): (string | number)[][] {
  if (!Array.isArray(input)) throw new Error('randuri_invalide (aștept un array de rânduri)')
  const MAX_R = 5_000
  const MAX_C = 256
  return input.slice(0, MAX_R).map((rand) => {
    const celule = Array.isArray(rand) ? rand : [rand] // un rând scalar → o singură celulă
    return celule.slice(0, MAX_C).map((c) => {
      if (typeof c === 'number' && Number.isFinite(c)) return c
      if (c === null || c === undefined) return ''
      if (typeof c === 'object') return JSON.stringify(c)
      return String(c)
    })
  })
}

/** Găsește UN fișier după nume (+ opțional tip), cel mai recent modificat. */
async function gasesteFisierDrive(
  query: string,
  mimeType: string | null,
  token: string,
): Promise<{ found: boolean; id?: string; name?: string; link?: string; error?: string }> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('pageSize', '1')
  url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink)')
  url.searchParams.set('orderBy', 'modifiedTime desc')
  const safe = (query || '').replaceAll("'", String.raw`\'`)
  const clauze = ['trashed = false']
  if (safe) clauze.unshift(`name contains '${safe}'`)
  if (mimeType) clauze.push(`mimeType = '${mimeType}'`)
  url.searchParams.set('q', clauze.join(' and '))
  const res = await tfetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { found: false, error: `drive_http_${res.status}` }
  const j = (await res.json()) as { files?: { id?: string; name?: string; webViewLink?: string }[] }
  const f = j.files?.[0]
  if (!f?.id) return { found: false }
  return { found: true, id: f.id, name: f.name, link: f.webViewLink }
}

const DOC_MIME = 'application/vnd.google-apps.document'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const MAX_TEXT_DRIVE = 100_000

// CREEAZĂ un Google Doc cu titlu + conținut. API Docs: creare goală, apoi
// batchUpdate insertText la începutul corpului (index 1).
async function createDoc(titlu: string, continut: string, token: string): Promise<string> {
  if (!titlu.trim()) return JSON.stringify({ error: 'missing_title' })
  const cRes = await tfetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: titlu.slice(0, 300) }),
  })
  if (!cRes.ok) return JSON.stringify({ error: `docs_create_http_${cRes.status}` })
  const doc = (await cRes.json()) as { documentId?: string }
  const id = doc.documentId
  if (!id) return JSON.stringify({ error: 'docs_create_no_id' })
  const text = (continut || '').slice(0, MAX_TEXT_DRIVE)
  if (text) {
    const uRes = await tfetch(`https://docs.googleapis.com/v1/documents/${id}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text } }] }),
    })
    if (!uRes.ok) return JSON.stringify({ error: `docs_write_http_${uRes.status}`, created_empty: true, id })
  }
  return JSON.stringify({ created: true, name: titlu, id, link: `https://docs.google.com/document/d/${id}/edit` })
}

// Sfârșitul corpului unui Doc (indexul de inserare pentru „adaugă la final").
async function docEndIndex(id: string, token: string): Promise<number | null> {
  const res = await tfetch(`https://docs.googleapis.com/v1/documents/${id}?fields=body(content(endIndex))`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const j = (await res.json()) as { body?: { content?: { endIndex?: number }[] } }
  const ends = (j.body?.content ?? []).map((c) => c.endIndex ?? 0)
  const end = ends.length ? Math.max(...ends) : 0
  return end > 1 ? end : 1
}

// EDITEAZĂ un Google Doc existent (găsit după nume). Moduri:
//   adauga            → adaugă text la finalul documentului
//   inlocuieste       → golește corpul și scrie textul nou
//   gaseste_inlocuieste → înlocuiește toate aparițiile lui `cauta` cu `inlocuieste`
async function editDoc(
  query: string,
  mod: string,
  text: string,
  cauta: string,
  inlocuieste: string,
  token: string,
): Promise<string> {
  const f = await gasesteFisierDrive(query, DOC_MIME, token)
  if (f.error) return JSON.stringify({ error: f.error })
  if (!f.found || !f.id) return JSON.stringify({ found: false, note: 'Niciun Google Doc pentru această căutare.' })

  const requests: unknown[] = []
  if (mod === 'gaseste_inlocuieste') {
    if (!cauta) return JSON.stringify({ error: 'missing_cauta' })
    requests.push({ replaceAllText: { containsText: { text: cauta, matchCase: false }, replaceText: inlocuieste || '' } })
  } else if (mod === 'inlocuieste') {
    const end = await docEndIndex(f.id, token)
    if (end === null) return JSON.stringify({ error: 'docs_read_failed' })
    if (end > 1) requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } })
    if (text) requests.push({ insertText: { location: { index: 1 }, text: text.slice(0, MAX_TEXT_DRIVE) } })
  } else {
    // adauga (implicit)
    if (!text) return JSON.stringify({ error: 'missing_text' })
    const end = await docEndIndex(f.id, token)
    if (end === null) return JSON.stringify({ error: 'docs_read_failed' })
    requests.push({ insertText: { location: { index: end - 1 }, text: `\n${text.slice(0, MAX_TEXT_DRIVE)}` } })
  }
  if (!requests.length) return JSON.stringify({ error: 'nimic_de_facut' })
  const uRes = await tfetch(`https://docs.googleapis.com/v1/documents/${f.id}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  if (!uRes.ok) return JSON.stringify({ error: `docs_edit_http_${uRes.status}` })
  return JSON.stringify({ edited: true, mod, name: f.name, id: f.id, link: `https://docs.google.com/document/d/${f.id}/edit` })
}

// CREEAZĂ un Google Sheet cu titlu + rânduri (2D). API Sheets: creare, apoi
// values.update pe A1.
async function createSheet(titlu: string, randuriRaw: unknown, token: string): Promise<string> {
  if (!titlu.trim()) return JSON.stringify({ error: 'missing_title' })
  let randuri: (string | number)[][] = []
  if (randuriRaw !== undefined && randuriRaw !== null) {
    try { randuri = normalizeazaRanduri(randuriRaw) } catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : 'randuri_invalide' }) }
  }
  const cRes = await tfetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: titlu.slice(0, 300) } }),
  })
  if (!cRes.ok) return JSON.stringify({ error: `sheets_create_http_${cRes.status}` })
  const sh = (await cRes.json()) as { spreadsheetId?: string }
  const id = sh.spreadsheetId
  if (!id) return JSON.stringify({ error: 'sheets_create_no_id' })
  if (randuri.length) {
    const uRes = await tfetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: randuri }),
      },
    )
    if (!uRes.ok) return JSON.stringify({ error: `sheets_write_http_${uRes.status}`, created_empty: true, id })
  }
  return JSON.stringify({ created: true, name: titlu, id, randuri: randuri.length, link: `https://docs.google.com/spreadsheets/d/${id}/edit` })
}

// EDITEAZĂ un Google Sheet existent (găsit după nume). Moduri:
//   adauga → adaugă rândurile la finalul foii (values.append)
//   scrie  → scrie rândurile începând de la `interval` (ex. "A1", "Foaie1!B2")
async function editSheet(
  query: string,
  mod: string,
  randuriRaw: unknown,
  interval: string,
  token: string,
): Promise<string> {
  let randuri: (string | number)[][]
  try { randuri = normalizeazaRanduri(randuriRaw) } catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : 'randuri_invalide' }) }
  if (!randuri.length) return JSON.stringify({ error: 'randuri_goale' })
  const f = await gasesteFisierDrive(query, SHEET_MIME, token)
  if (f.error) return JSON.stringify({ error: f.error })
  if (!f.found || !f.id) return JSON.stringify({ found: false, note: 'Niciun Google Sheet pentru această căutare.' })

  const rangeRaw = (mod === 'scrie' ? (interval || 'A1') : 'A1').replace(/[^A-Za-z0-9!:$ ]/g, '')
  const range = encodeURIComponent(rangeRaw || 'A1')
  const url =
    mod === 'scrie'
      ? `https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${range}?valueInputOption=USER_ENTERED`
      : `https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  const uRes = await tfetch(url, {
    method: mod === 'scrie' ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: randuri }),
  })
  if (!uRes.ok) return JSON.stringify({ error: `sheets_edit_http_${uRes.status}` })
  return JSON.stringify({ edited: true, mod, name: f.name, id: f.id, randuri: randuri.length, link: `https://docs.google.com/spreadsheets/d/${f.id}/edit` })
}

async function getTasks(max: number, token: string): Promise<string> {
  const url = new URL('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks')
  url.searchParams.set('maxResults', String(Math.min(Math.max(max, 1), 100)))
  url.searchParams.set('showCompleted', 'false')
  const res = await tfetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `tasks_http_${res.status}` })
  const j = (await res.json()) as { items?: { id?: string; title?: string; due?: string; status?: string }[] }
  const tasks = (j.items ?? []).map((t) => ({ id: t.id ?? '', title: t.title ?? '', due: t.due ?? '', status: t.status ?? '' }))
  return JSON.stringify({ tasks })
}

// TICK A TASK AS DONE (SINGLE BRAIN §2.2). EXISTING tasks scope (the same as
// add_task) — no re-authentication. The id comes from get_tasks.
async function completeTask(id: string, token: string): Promise<string> {
  if (!id) return JSON.stringify({ error: 'missing_task_id', hint: 'Cheamă întâi get_tasks ca să iei id-ul.' })
  const res = await tfetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  })
  if (!res.ok) return JSON.stringify({ error: `tasks_complete_http_${res.status}` })
  return JSON.stringify({ completed: true, id })
}

async function addTask(title: string, due: string, token: string): Promise<string> {
  if (!title) return JSON.stringify({ error: 'missing_title' })
  const body: { title: string; due?: string } = { title }
  if (due && !Number.isNaN(Date.parse(due))) body.due = new Date(due).toISOString()
  const res = await tfetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return JSON.stringify({ error: `tasks_add_http_${res.status}` })
  return JSON.stringify({ added: true, title })
}

interface PersonName { displayName?: string; givenName?: string }
interface PersonEmail { value?: string }
interface PersonPhone { value?: string }
interface Person {
  names?: PersonName[]
  emailAddresses?: PersonEmail[]
  phoneNumbers?: PersonPhone[]
}

async function searchContacts(query: string, max: number, token: string): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const url = new URL('https://people.googleapis.com/v1/people:searchContacts')
  url.searchParams.set('query', query)
  url.searchParams.set('pageSize', String(Math.min(Math.max(max, 1), 25)))
  url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers')
  const res = await tfetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `contacts_http_${res.status}` })
  const j = (await res.json()) as { results?: { person?: Person }[] }
  const contacts = (j.results ?? []).map((r) => ({
    name: r.person?.names?.[0]?.displayName ?? '',
    email: r.person?.emailAddresses?.[0]?.value ?? '',
    phone: r.person?.phoneNumbers?.[0]?.value ?? '',
  }))
  return JSON.stringify({ contacts })
}

async function addContact(name: string, email: string, phone: string, token: string): Promise<string> {
  if (!name) return JSON.stringify({ error: 'missing_name' })
  const body: Person = { names: [{ givenName: name }] }
  if (email) body.emailAddresses = [{ value: email }]
  if (phone) body.phoneNumbers = [{ value: phone }]
  const res = await tfetch('https://people.googleapis.com/v1/people:createContact', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return JSON.stringify({ error: `contacts_create_http_${res.status}` })
  return JSON.stringify({ added: true, name })
}

// ── Keyless / shared-key skills (no user OAuth token needed) ──

const OSM_UA = 'KelionAI/1.0 (kelionai.app)'

// Wikimedia blocks datacenter IPs (our VPS is Contabo) UNLESS the User-Agent
// carries real contact info, per https://meta.wikimedia.org/wiki/User-Agent_policy.
// The bare "(kelionai.app)" form gets a hard 403 ("Contabo networks are
// forbidden due to abuse") → wikipedia_lookup always answered not_found.
const WIKIPEDIA_UA = 'KelionAI/1.0 (https://kelionai.app; contact@kelion.ai)'

interface NominatimPlace {
  display_name?: string
  lat?: string
  lon?: string
  type?: string
}

async function geocodeOne(query: string): Promise<NominatimPlace | null> {
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.searchParams.set('q', query)
  u.searchParams.set('format', 'json')
  u.searchParams.set('limit', '1')
  const res = await tfetch(u, { headers: { 'User-Agent': OSM_UA } })
  if (!res.ok) return null
  const arr = (await res.json()) as NominatimPlace[]
  return arr[0] ?? null
}

async function mapsSearch(query: string, max: number): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const u = new URL('https://nominatim.openstreetmap.org/search')
  u.searchParams.set('q', query)
  u.searchParams.set('format', 'json')
  u.searchParams.set('limit', String(Math.min(Math.max(max, 1), 10)))
  const res = await tfetch(u, { headers: { 'User-Agent': OSM_UA } })
  if (!res.ok) return JSON.stringify({ error: `maps_http_${res.status}` })
  const arr = (await res.json()) as NominatimPlace[]
  const places = arr.map((p) => ({
    name: p.display_name ?? '',
    lat: p.lat ?? '',
    lon: p.lon ?? '',
    type: p.type ?? '',
  }))
  // Screen URL: the map gets DISPLAYED from a single tool call (the brain
  // doesn't always make the second show_on_screen). PE DOMENIUL NOSTRU, nu pe
  // openstreetmap.org (8 aug: iframe-ul OSM apărea „întotdeauna" ca pagină
  // prăbușită în Chrome-ul ownerului — un cadru de pe alt domeniu poate fi ucis
  // de blocante; al nostru nu). runGoogleTool → default-case writes {monitor}.
  const f = places[0]
  const la = Number(f?.lat)
  const lo = Number(f?.lon)
  const screen_url =
    Number.isFinite(la) && Number.isFinite(lo)
      ? `/api/route?punct=${la},${lo}&nume=${encodeURIComponent((f?.name ?? '').slice(0, 120))}`
      : undefined
  return JSON.stringify({ places, screen_url })
}

// EXACT COORDINATES → ADDRESS + POSTCODE (Adrian, Aug 1: "it can't pair the
// exact coordinates with the postcode"). The same Nominatim reverse geocode as
// the GPS context, but callable BY THE BRAIN for any point — the user's or an
// arbitrary one. Never guesses: no postcode in the address → postcode: null.
async function lookupAddress(lat: number, lon: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    return JSON.stringify({
      error: 'missing_coordinates',
      hint: 'Ask the user for the coordinates, or use the device GPS injected in your context for their current spot (there is no get_location tool — it does not exist).',
    })
  const info = await reverseGeocodeInfo(lat, lon)
  if (!info)
    return JSON.stringify({
      error: 'geocode_unavailable',
      hint: 'The address service did not answer right now — try again shortly.',
    })
  return JSON.stringify({
    lat,
    lon,
    address: info.place,
    postcode: info.postcode || null,
    note: info.postcode
      ? undefined
      : 'No postcode is mapped for this exact point (open field, road between addresses, or incomplete map data) — the address above is still real.',
  })
}

// Build a ready-to-embed monitor URL for a promo-clip scene (map or weather) —
// the exact same surfaces the live skills use, resolved server-side so a clip
// scene can never 404 from a guessed URL.
export async function promoSceneUrl(kind: 'map' | 'weather', query: string): Promise<string | null> {
  const p = await geocodeOne(query)
  if (!p?.lat || !p?.lon) return null
  const lat = Number(p.lat)
  const lon = Number(p.lon)
  if (kind === 'weather') {
    return (
      `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}` +
      `&zoom=8&level=surface&overlay=temp&marker=true&type=map&location=coordinates&metricTemp=%C2%B0C`
    )
  }
  // Harta NOASTRĂ same-origin, nu openstreetmap.org (8 aug: cadrul străin
  // apărea „întotdeauna" ca pagină prăbușită — vezi mapsSearch).
  return `/api/route?punct=${lat},${lon}&nume=${encodeURIComponent((p.display_name ?? '').slice(0, 120))}`
}

// OSRM servers, tried in order: the classic demo (rate-limited under load — the
// cause of intermittent "service down") then the FOSSGIS production instance.
// Same API on both. Exported for the /api/route map page too.
export const OSRM_BASES = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
]

interface OsrmStep {
  distance?: number
  name?: string
  maneuver?: { type?: string; modifier?: string }
}

export async function osrmRoute(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  params: string,
): Promise<Record<string, unknown> | null> {
  for (const base of OSRM_BASES) {
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 8000)
      const res = await tfetch(`${base}/${fromLon},${fromLat};${toLon},${toLat}?${params}`, {
        signal: ctrl.signal,
      })
      clearTimeout(to)
      if (!res.ok) continue // rate-limited/down → next server
      const j = (await res.json()) as Record<string, unknown>
      if ((j as { routes?: unknown[] }).routes?.length) return j
    } catch {
      /* timeout/network — next server */
    }
  }
  return null
}

// One OSRM maneuver → a short human instruction Kelion can speak.
function stepText(s: OsrmStep): string {
  const t = s.maneuver?.type ?? ''
  const mod = s.maneuver?.modifier ?? ''
  const road = s.name ? ` onto ${s.name}` : ''
  const dist = s.distance && s.distance > 0 ? ` (${s.distance >= 950 ? `${(s.distance / 1000).toFixed(1)} km` : `${Math.round(s.distance / 10) * 10} m`})` : ''
  if (t === 'depart') return `Start${road}${dist}`
  if (t === 'arrive') return 'Arrive at destination'
  if (t === 'roundabout' || t === 'rotary') return `At the roundabout take the exit${road}${dist}`
  if (t === 'merge') return `Merge ${mod}${road}${dist}`
  if (t === 'on ramp') return `Take the ramp ${mod}${road}${dist}`
  if (t === 'off ramp') return `Take the exit ${mod}${road}${dist}`
  if (t === 'fork') return `Keep ${mod} at the fork${road}${dist}`
  if (mod) return `${t === 'continue' ? 'Continue' : 'Turn'} ${mod}${road}${dist}`
  return `Continue${road}${dist}`
}

// „lat,lon" e contract, nu noroc (10 aug): GPS-ul din context vine ca
// coordonate — alea NU trec prin geocoder (Nominatim pe „52.19,-1.7" poate
// întoarce orice clădire din apropiere), se folosesc direct.
function caCoordonate(s: string): { lat: string; lon: string; display_name: string } | null {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat: m[1], lon: m[2], display_name: `${m[1]},${m[2]} (coordonate)` }
}

async function mapsDirections(origin: string, destination: string): Promise<string> {
  if (!origin || !destination) return JSON.stringify({ error: 'missing_origin_or_destination' })
  const [a, b] = await Promise.all([
    caCoordonate(origin) ?? geocodeOne(origin),
    caCoordonate(destination) ?? geocodeOne(destination),
  ])
  // Eșecul e NUMIT pe capăt (10 aug, „casa lui Shakespeare" → nimic găsit):
  // creierul trebuie să știe CE capăt a picat ca să reîncerce cu numele canonic.
  if (!a?.lat && !b?.lat) return JSON.stringify({ error: 'could_not_geocode', care: 'ambele', origin, destination })
  if (!a?.lat) return JSON.stringify({ error: 'could_not_geocode', care: 'origin', origin })
  if (!b?.lat) return JSON.stringify({ error: 'could_not_geocode', care: 'destination', destination })
  const [aLat, aLon, bLat, bLon] = [Number(a.lat), Number(a.lon), Number(b.lat), Number(b.lon)]
  // steps=true → REAL turn-by-turn instructions, not just distance/duration.
  const j = (await osrmRoute(aLon, aLat, bLon, bLat, 'overview=false&steps=true')) as {
    routes?: { distance?: number; duration?: number; legs?: { steps?: OsrmStep[] }[] }[]
  } | null
  const r = j?.routes?.[0]
  if (!r) return JSON.stringify({ error: 'routing_unavailable_all_servers' })
  const steps = (r.legs?.[0]?.steps ?? []).map(stepText)
  // Long routes: keep the first 25 maneuvers (the start matters when driving).
  const directions = steps.length > 25 ? [...steps.slice(0, 25), `… +${steps.length - 25} more steps`] : steps
  return JSON.stringify({
    origin: a.display_name ?? origin,
    destination: b.display_name ?? destination,
    distance_km: Math.round((r.distance ?? 0) / 100) / 10,
    duration_min: Math.round((r.duration ?? 0) / 60),
    directions,
    // Our own live Leaflet/OSRM map — it draws the route AND follows the car's
    // GPS (a blue dot + remaining distance), so it's a real driving copilot, not
    // the static Google Embed preview.
    screen_url: `/api/route?from=${aLat},${aLon}&to=${bLat},${bLon}`,
  })
}

// Watch/short link → embed URL for the monitor (playable in an iframe).
// autoplay=1: the clip STARTS on its own on the monitor (Adrian, Jul 27:
// "play doesn't work" — the player opened STOPPED). enablejsapi=1: the client
// can lower its volume while Kelion speaks (postMessage).
function ytEmbed(link: string): string | undefined {
  const m = (link || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)
  return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&enablejsapi=1` : undefined
}

// The REAL playability check (Adrian, Jul 27: "play doesn't work on
// youtube"): web search can return invented/dead ids, and official music
// clips often have embedding FORBIDDEN — both ended up on the monitor as a
// dead player. YouTube's oEmbed answers 200 ONLY for clips that exist AND
// allow embedding → we filter on it.
async function ytPlayable(link: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(link)}&format=json`,
      { signal: AbortSignal.timeout(4000) },
    )
    return r.ok
  } catch {
    return false
  }
}

export interface YoutubeCandidate {
  title: string
  link: string
}

// Exported so the parsing rules are testable without network (the same pure-
// composer pattern as composeSerperResult): real YouTube links from the search
// answer — citations first (the safest), then any labelled/bare link in the
// text — deduplicated, nothing invented here.
export function extractYoutubeCandidates(
  text: string,
  sources: { title: string; url: string }[],
): YoutubeCandidate[] {
  const seen = new Set<string>()
  const videos: YoutubeCandidate[] = []
  // From the real sources (citations) — the safest.
  for (const s of sources) {
    if (ytEmbed(s.url) && !seen.has(s.url)) {
      seen.add(s.url)
      videos.push({ title: s.title, link: s.url })
    }
  }
  // Plus any youtube link in the text (Title — URL / bare URL).
  const ytUrl = '(?:https?:\\/\\/)?(?:www\\.)?(?:youtube\\.com\\/watch\\?v=[\\w-]+|youtu\\.be\\/[\\w-]+)'
  const labelled = new RegExp(`(?:\\[([^\\]]+)\\]\\((${ytUrl})\\)|([^\\n—\\-]+?)\\s*[—-]\\s*(${ytUrl}))`, 'g')
  let m: RegExpExecArray | null
  while ((m = labelled.exec(text)) !== null) {
    const title = (m[1] ?? m[3] ?? '').trim()
    let link = (m[2] ?? m[4] ?? '').trim()
    if (!link.startsWith('http')) link = `https://${link}`
    if (seen.has(link)) continue
    seen.add(link)
    videos.push({ title, link })
  }
  return videos
}

// Exported for the honesty tests (search-backend-down vs. no-videos-found are
// different answers and the tests pin them apart).
export async function youtubeSearch(query: string, max: number): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const n = Math.min(Math.max(max, 1), 10)
  // Through Serper's /videos endpoint — REAL Google video results, no OpenRouter.
  const sources = await serperVideos(query, 10)
  // The search backend itself failed (missing key, quota, non-ok or network →
  // no sources). "I could not search" and "no videos exist" are different truths
  // — the old code merged them into not_found, and the brain would tell the user
  // there are no videos when in fact the search never ran.
  if (sources.length === 0) return JSON.stringify({ error: 'search_unavailable' })
  const videos = extractYoutubeCandidates('', sources)
  if (videos.length > 0) {
    // Only clips that can ACTUALLY play on the monitor (checked in parallel,
    // a single network round) — a dead player never gets displayed again.
    const cand = videos.slice(0, 6)
    const flags = await Promise.all(cand.map((v) => ytPlayable(v.link)))
    const playable = cand.filter((_, i) => flags[i])
    if (playable.length > 0) {
      return JSON.stringify({ videos: playable.slice(0, n), screen_url: ytEmbed(playable[0].link) })
    }
  }
  return JSON.stringify({ videos: [], not_found: true })
}
async function translateText(text: string, target: string): Promise<string> {
  if (!text || !target) return JSON.stringify({ error: 'missing_text_or_target' })
  // GEMINI-ONLY (3 aug — ramura de rezervă OpenRouter a fost extirpată): fără
  // cheie Gemini nu există traducător, și o spunem cinstit (regula #1 — nu
  // simulăm un serviciu care nu e configurat).
  if (!config.geminiKey) return JSON.stringify({ error: 'translate_not_configured' })
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`
  const res = await tfetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: `Translate the following text into ${target}. Return ONLY the translation:\n\n${text}` },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    }),
  })
  if (!res.ok) return JSON.stringify({ error: `translate_http_${res.status}` })
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const out = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  // An EMPTY answer is NOT a translation — the old code returned
  // { translation: "" }, which the caller could not tell apart from success.
  if (!out) return JSON.stringify({ error: 'translate_empty' })
  return JSON.stringify({ translation: out, target })
}

// BULK TRANSLATION (Adrian, Jul 10: "a button that translates into Romanian
// instantly from any language" — in the admin conversation viewer). Translates
// a LIST of messages into `target`, in parallel; if one translation fails
// (Gemini unconfigured or an error), it returns the ORIGINAL text for that
// message — nothing is lost — and counts it in `failed`, so the admin SEES
// that part of the "translation" is actually untranslated original, instead
// of silently believing everything was translated.
export interface TranslateManyResult {
  /** Aligned 1:1 with the input; a failed message keeps its ORIGINAL text. */
  translations: string[]
  /** How many messages could NOT be translated (their text is the original). */
  failed: number
}

export async function translateMany(texts: string[], target: string): Promise<TranslateManyResult> {
  const results = await Promise.all(
    texts.map(async (t) => {
      const s = (t ?? '').trim()
      if (!s) return { text: t ?? '', ok: true } // nothing to translate — not a failure
      try {
        const r = await translateText(s, target)
        const j = JSON.parse(r) as { translation?: string }
        if (j.translation && j.translation.trim()) return { text: j.translation, ok: true }
        return { text: t ?? '', ok: false }
      } catch {
        return { text: t ?? '', ok: false }
      }
    }),
  )
  return { translations: results.map((r) => r.text), failed: results.filter((r) => !r.ok).length }
}

// Knowledge lookup — keyless Wikipedia REST API (search → page summary). Gives
// Kelion reliable facts to use instead of guessing, and helps while web search
// is unavailable.
async function wikipediaLookup(query: string): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const qWords = new Set(norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  try {
    // Search BOTH the Romanian and English Wikipedia (the app is Romanian-primary,
    // so English-only search returned wrong pages for terms like "Turnul Eiffel").
    // Gather candidates from both editions and pick the title that best overlaps
    // the query (accent-insensitive); fetch that page's summary from its edition.
    const editions = ['ro', 'en']
    const candidates: { ed: string; key: string; title: string }[] = []
    for (const ed of editions) {
      const s = new URL(`https://${ed}.wikipedia.org/w/rest.php/v1/search/page`)
      s.searchParams.set('q', query)
      s.searchParams.set('limit', '3')
      const sr = await tfetch(s, { headers: { 'User-Agent': WIKIPEDIA_UA } })
      if (!sr.ok) continue
      const sj = (await sr.json()) as { pages?: { key?: string; title?: string }[] }
      for (const p of sj.pages ?? []) if (p.key) candidates.push({ ed, key: p.key, title: p.title ?? '' })
    }
    if (candidates.length === 0) return JSON.stringify({ error: 'not_found' })
    let best = candidates[0]
    let bestScore = -1
    for (const c of candidates) {
      const score = norm(c.title)
        .split(/[^a-z0-9]+/)
        .filter((w) => qWords.has(w)).length
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    const u = `https://${best.ed}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.key)}`
    const r = await tfetch(u, { headers: { 'User-Agent': WIKIPEDIA_UA } })
    if (!r.ok) return JSON.stringify({ error: `wiki_http_${r.status}` })
    const j = (await r.json()) as {
      title?: string
      extract?: string
      content_urls?: { desktop?: { page?: string } }
    }
    return JSON.stringify({
      title: j.title ?? best.title ?? query,
      summary: j.extract ?? '',
      url: j.content_urls?.desktop?.page ?? '',
    })
  } catch {
    return JSON.stringify({ error: 'wiki_failed' })
  }
}

// Live FX conversion — keyless, no signup (open.er-api.com).
async function convertCurrency(amount: number, from: string, to: string): Promise<string> {
  const f = from.trim().toUpperCase()
  const t = to.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) return JSON.stringify({ error: 'bad_currency_code' })
  const amt = Number.isFinite(amount) && amount > 0 ? amount : 1
  try {
    const r = await tfetch(`https://open.er-api.com/v6/latest/${f}`)
    if (!r.ok) return JSON.stringify({ error: `fx_http_${r.status}` })
    const j = (await r.json()) as { result?: string; rates?: Record<string, number> }
    const rate = j.rates?.[t]
    if (j.result !== 'success' || typeof rate !== 'number') {
      return JSON.stringify({ error: 'rate_unavailable' })
    }
    return JSON.stringify({
      from: f, to: t, amount: amt, rate,
      converted: Math.round(amt * rate * 100) / 100,
    })
  } catch {
    return JSON.stringify({ error: 'fx_failed' })
  }
}

// Current date/time in any IANA timezone (the model otherwise has no reliable clock).
function getTime(timezone: string): string {
  const tz = timezone.trim() || 'UTC'
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'long',
    })
    return JSON.stringify({ timezone: tz, datetime: fmt.format(new Date()), iso: new Date().toISOString() })
  } catch {
    return JSON.stringify({ error: 'bad_timezone' })
  }
}

export async function runGoogleTool(
  name: string,
  input: unknown,
  token: string,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>
  try {
    // These don't use the user's Google token.
    if (name === 'web_search') return await webSearch(str(args.query), num(args.max_results, 5))
    if (name === 'get_weather')
      return await weather(str(args.location), num(args.lat, Number.NaN), num(args.lon, Number.NaN))
    if (name === 'maps_search') return await mapsSearch(str(args.query), num(args.max_results, 5))
    if (name === 'maps_directions')
      return await mapsDirections(str(args.origin), str(args.destination))
    if (name === 'lookup_address') return await lookupAddress(num(args.lat, Number.NaN), num(args.lon, Number.NaN))
    if (name === 'youtube_search') return await youtubeSearch(str(args.query), num(args.max_results, 5))
    if (name === 'translate_text') return await translateText(str(args.text), str(args.target))
    if (name === 'wikipedia_lookup') return await wikipediaLookup(str(args.query))
    if (name === 'convert_currency')
      return await convertCurrency(num(args.amount, 1), str(args.from), str(args.to))
    if (name === 'get_time') return getTime(str(args.timezone))

    // These need the user's Google access. Since login now grants only identity,
    // the heavy scopes come from the separate "Connect Google" button. If it was
    // never done (no token) OR Google rejects on auth (token lacks the scope /
    // was revoked → 401/403), return ONE clear signal telling the brain to ask
    // the user to connect — never a raw HTTP code.
    const NEEDS_CONNECT = JSON.stringify({
      error: 'google_not_connected',
      hint: 'The user has not connected their Google account (or access expired). Ask them to click "Connect Google" at the top of the app to grant Gmail, Calendar, Drive, Tasks and Contacts — then retry.',
    })
    if (!token) return NEEDS_CONNECT

    let result: string
    if (name === 'get_calendar_events') result = await calendarEvents(num(args.max_results, 10), token)
    else if (name === 'get_recent_emails')
      result = await recentEmails(str(args.query), num(args.max_results, 5), token)
    else if (name === 'read_email') result = await readEmail(str(args.query), token)
    else if (name === 'send_email')
      result = await sendEmail(str(args.to), str(args.subject), str(args.body), token)
    else if (name === 'create_calendar_event')
      result = await createCalendarEvent(str(args.summary), str(args.start), str(args.end), str(args.location), token, args.meet === true)
    else if (name === 'create_presentation') result = await createPresentation(str(args.title), args.slides, token)
    else if (name === 'create_form') result = await createForm(str(args.title), str(args.description), args.questions, token)
    else if (name === 'delete_calendar_event') result = await deleteCalendarEvent(str(args.id), token)
    else if (name === 'complete_task') result = await completeTask(str(args.id), token)
    else if (name === 'get_drive_files') result = await driveFiles(str(args.query), num(args.max_results, 10), token)
    else if (name === 'read_drive_file') result = await readDriveFile(str(args.query), token)
    // L1i: editare avansată (Docs + Sheets) în contul omului logat.
    else if (name === 'create_doc') result = await createDoc(str(args.title), str(args.content), token)
    else if (name === 'edit_doc')
      result = await editDoc(str(args.query), str(args.mode) || 'adauga', str(args.text), str(args.find), str(args.replace), token)
    else if (name === 'create_sheet') result = await createSheet(str(args.title), args.rows, token)
    else if (name === 'edit_sheet')
      result = await editSheet(str(args.query), str(args.mode) || 'adauga', args.rows, str(args.range), token)
    else if (name === 'get_tasks') result = await getTasks(num(args.max_results, 20), token)
    else if (name === 'add_task') result = await addTask(str(args.title), str(args.due), token)
    else if (name === 'search_contacts')
      result = await searchContacts(str(args.query), num(args.max_results, 5), token)
    else if (name === 'add_contact')
      result = await addContact(str(args.name), str(args.email), str(args.phone), token)
    else return JSON.stringify({ error: 'unknown_tool' })

    if (/_http_(401|403)\b/.test(result)) return NEEDS_CONNECT
    return result
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'tool_failed' })
  }
}
