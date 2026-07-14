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
    name: 'web_search',
    description:
      'Search the live web for current, real information (news, facts, prices, anything recent). Returns not just result snippets but also a direct answer, a knowledge-graph fact box, "people also ask" questions, fresh news, and related searches — use it whenever the answer depends on up-to-date or external information you do not already know.',
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
      "Create an event in the user's Google Calendar. Times must be ISO 8601 (e.g. 2026-07-02T15:00:00). If no end is given, a 1-hour event is created.",
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title.' },
        start: { type: 'string', description: 'Start datetime, ISO 8601.' },
        end: { type: 'string', description: 'End datetime, ISO 8601 (optional).' },
        location: { type: 'string', description: 'Location (optional).' },
      },
      required: ['summary', 'start'],
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
      'Find places, addresses or points of interest on the map and their coordinates. Use for "where is X", addresses, or locating a place.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Place or address, e.g. "Athenaeum Bucharest".' },
        max_results: { type: 'number', description: 'How many places (default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'maps_directions',
    description: 'Get driving distance and travel time between two places.',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Start place or address.' },
        destination: { type: 'string', description: 'Destination place or address.' },
      },
      required: ['origin', 'destination'],
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

// Best-effort reverse geocode (device GPS → human place name) so the brain knows
// where "here" is. Keyless OpenStreetMap Nominatim; short timeout, never throws.
// Cached by ~100 m (3 decimals); failures are negative-cached briefly so an
// outage can't cause a lookup storm.
const geoCache = new Map<string, string>()
const geoRetryAt = new Map<string, number>()
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = geoCache.get(key)
  if (hit !== undefined) return hit
  if ((geoRetryAt.get(key) ?? 0) > Date.now()) return ''
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse')
    u.searchParams.set('lat', String(lat))
    u.searchParams.set('lon', String(lon))
    u.searchParams.set('format', 'json')
    u.searchParams.set('zoom', '14')
    const res = await tfetch(u, {
      headers: { 'User-Agent': 'KelionAI/1.0 (kelionai.app)' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      geoRetryAt.set(key, Date.now() + 60_000)
      return ''
    }
    const j = (await res.json()) as { display_name?: string }
    const name = j.display_name ?? ''
    geoCache.set(key, name)
    return name
  } catch {
    geoRetryAt.set(key, Date.now() + 60_000)
    return ''
  }
}

// Non-blocking variant for the chat hot path: returns the cached place name
// instantly ('' when not resolved yet) and warms the cache in the background.
// The GPS place name must NEVER delay a reply — the raw lat/lon (which the
// skills use directly) is always injected regardless.
const geoInFlight = new Set<string>()
export function reverseGeocodeCached(lat: number, lon: number): string {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = geoCache.get(key)
  if (hit !== undefined) return hit
  if (!geoInFlight.has(key)) {
    geoInFlight.add(key)
    void reverseGeocode(lat, lon).finally(() => geoInFlight.delete(key))
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
    summary: e.summary ?? '(no title)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    location: e.location ?? '',
  }))
  return JSON.stringify({ events })
}

async function recentEmails(query: string, max: number, token: string): Promise<string> {
  const n = Math.min(Math.max(max, 1), 10)
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  listUrl.searchParams.set('maxResults', String(n))
  if (query) listUrl.searchParams.set('q', query)
  const listRes = await tfetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (!listRes.ok) return JSON.stringify({ error: `gmail_http_${listRes.status}` })
  const list = (await listRes.json()) as { messages?: { id: string }[] }
  const ids = (list.messages ?? []).slice(0, n)
  const emails: { from: string; subject: string; date: string; snippet: string }[] = []
  for (const { id } of ids) {
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

interface SerperResult {
  title?: string
  link?: string
  snippet?: string
  date?: string
}

// Live web search via Gemini's built-in Google Search grounding. Uses the
// GEMINI_API_KEY (no Serper key needed). Returns a grounded answer plus the
// real source pages Google used. Returns null on any failure so callers can
// fall back.
interface GeminiGroundResult {
  text: string
  sources: { title: string; link: string }[]
}

async function geminiGroundedSearch(prompt: string): Promise<GeminiGroundResult | null> {
  if (!config.geminiKey) return null
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`
  let res: Response
  try {
    res = await tfetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const j = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] }
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
    }[]
  }
  const cand = j.candidates?.[0]
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  const seen = new Set<string>()
  const sources: { title: string; link: string }[] = []
  for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
    const link = c.web?.uri ?? ''
    if (!link || seen.has(link)) continue
    seen.add(link)
    sources.push({ title: c.web?.title ?? '', link })
  }
  if (!text && sources.length === 0) return null
  return { text, sources }
}

// VEDERE (Adrian, 13 iul: „Kelion să VADĂ app-ul"): dă lui Kelion OCHI — Gemini
// se uită la un screenshot și răspunde la o întrebare despre ce se vede. Folosit
// de verificarea vizuală: constructorul confirmă că rezultatul cerut chiar apare
// pe ecran (gesturi, UI, layout), nu doar că „build trece".
export async function geminiVision(jpegBase64: string, question: string): Promise<string | null> {
  if (!config.geminiKey) return null
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`
  let res: Response
  try {
    res = await tfetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: question },
              { inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
      }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  return text || null
}

async function webSearch(query: string, max: number): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const n = Math.min(Math.max(max, 1), 12)

  // Primary: Serper.dev (the paid plan) when a key is set and accepted. We ask
  // for EVERYTHING Google returns — not only the organic links but the direct
  // answer box, the knowledge-graph fact panel, "people also ask", fresh news
  // and related searches — so the brain answers from the richest, most current
  // picture possible (căutare web „la maxim", 10 iul).
  if (config.serperKey) {
    try {
      const res = await tfetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: Math.max(n, 10) }),
      })
      if (res.ok) {
        const j = (await res.json()) as {
          organic?: SerperResult[]
          answerBox?: { answer?: string; snippet?: string; title?: string; link?: string }
          knowledgeGraph?: {
            title?: string
            type?: string
            description?: string
            attributes?: Record<string, string>
            website?: string
          }
          peopleAlsoAsk?: { question?: string; snippet?: string; link?: string }[]
          topStories?: { title?: string; link?: string; source?: string; date?: string }[]
          news?: { title?: string; link?: string; source?: string; date?: string }[]
          relatedSearches?: { query?: string }[]
        }
        const results = (j.organic ?? []).slice(0, n).map((r) => ({
          title: r.title ?? '',
          link: r.link ?? '',
          snippet: r.snippet ?? '',
          ...(r.date ? { date: r.date } : {}),
        }))
        const kg = j.knowledgeGraph
        const stories = (j.topStories ?? j.news ?? [])
          .slice(0, 4)
          .map((s) => ({ title: s.title ?? '', link: s.link ?? '', source: s.source ?? '', date: s.date ?? '' }))
        const paa = (j.peopleAlsoAsk ?? [])
          .slice(0, 4)
          .map((p) => ({ question: p.question ?? '', snippet: p.snippet ?? '', link: p.link ?? '' }))
        const related = (j.relatedSearches ?? []).slice(0, 6).map((r) => r.query ?? '').filter(Boolean)
        const out = {
          answer: j.answerBox?.answer ?? j.answerBox?.snippet ?? '',
          ...(kg
            ? {
                knowledgeGraph: {
                  title: kg.title ?? '',
                  type: kg.type ?? '',
                  description: kg.description ?? '',
                  attributes: kg.attributes ?? {},
                  website: kg.website ?? '',
                },
              }
            : {}),
          results,
          ...(paa.length ? { peopleAlsoAsk: paa } : {}),
          ...(stories.length ? { news: stories } : {}),
          ...(related.length ? { related } : {}),
          source: 'serper',
        }
        // Only accept a Serper answer that actually carries signal; otherwise
        // fall through to Gemini so search never returns an empty shell.
        if (out.answer || results.length || 'knowledgeGraph' in out) return JSON.stringify(out)
      }
      // Non-OK (e.g. 403 bad key) → fall through to Gemini so search still works.
    } catch {
      /* network error → fall through to Gemini */
    }
  }

  // Fallback: Gemini Google Search grounding (uses the Gemini key). Guarantees
  // search keeps working even if the Serper key is missing or rejected.
  const g = await geminiGroundedSearch(query)
  if (g) {
    return JSON.stringify({
      answer: g.text,
      results: g.sources.slice(0, n).map((s) => ({ title: s.title, link: s.link, snippet: '' })),
      source: 'google',
    })
  }

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
): Promise<string> {
  if (!summary || !start) return JSON.stringify({ error: 'missing_summary_or_start' })
  const startMs = Date.parse(start)
  if (Number.isNaN(startMs)) return JSON.stringify({ error: 'bad_start_datetime' })
  const endIso = end && !Number.isNaN(Date.parse(end))
    ? new Date(end).toISOString()
    : new Date(startMs + 3_600_000).toISOString()
  const res = await tfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      location: location || undefined,
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: endIso },
    }),
  })
  if (!res.ok) return JSON.stringify({ error: `calendar_create_http_${res.status}` })
  const j = (await res.json()) as { htmlLink?: string }
  return JSON.stringify({ created: true, summary, start, link: j.htmlLink ?? '' })
}

async function driveFiles(query: string, max: number, token: string): Promise<string> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('pageSize', String(Math.min(Math.max(max, 1), 25)))
  url.searchParams.set('fields', 'files(name,mimeType,modifiedTime,webViewLink)')
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
    files?: { name?: string; mimeType?: string; modifiedTime?: string; webViewLink?: string }[]
  }
  return JSON.stringify({ files: j.files ?? [] })
}

async function getTasks(max: number, token: string): Promise<string> {
  const url = new URL('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks')
  url.searchParams.set('maxResults', String(Math.min(Math.max(max, 1), 100)))
  url.searchParams.set('showCompleted', 'false')
  const res = await tfetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `tasks_http_${res.status}` })
  const j = (await res.json()) as { items?: { title?: string; due?: string; status?: string }[] }
  const tasks = (j.items ?? []).map((t) => ({ title: t.title ?? '', due: t.due ?? '', status: t.status ?? '' }))
  return JSON.stringify({ tasks })
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
  return JSON.stringify({ places })
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
  const d = 0.02
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`
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

async function mapsDirections(origin: string, destination: string): Promise<string> {
  if (!origin || !destination) return JSON.stringify({ error: 'missing_origin_or_destination' })
  const [a, b] = await Promise.all([geocodeOne(origin), geocodeOne(destination)])
  if (!a?.lat || !b?.lat) return JSON.stringify({ error: 'could_not_geocode' })
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

async function youtubeSearch(query: string, max: number): Promise<string> {
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const n = Math.min(Math.max(max, 1), 10)

  // Primary: Serper.dev (the paid plan) when a key is set and accepted.
  if (config.serperKey) {
    try {
      const res = await tfetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${query} site:youtube.com` }),
      })
      if (res.ok) {
        const j = (await res.json()) as { organic?: SerperResult[] }
        const videos = (j.organic ?? [])
          .filter((r) => (r.link ?? '').includes('youtube.com/watch') || (r.link ?? '').includes('youtu.be/'))
          .slice(0, n)
          .map((r) => ({ title: r.title ?? '', link: r.link ?? '' }))
        if (videos.length > 0) return JSON.stringify({ videos })
      }
    } catch {
      /* fall through to Gemini */
    }
  }

  // Fallback: Gemini grounded search, asked for real YouTube watch links.
  const g = await geminiGroundedSearch(
    `Find the best YouTube videos for: "${query}". ` +
      `Reply ONLY as a list, one per line, in the form: Title — https://www.youtube.com/watch?v=ID ` +
      `using real, currently-available videos.`,
  )
  if (g) {
    const videos: { title: string; link: string }[] = []
    const seen = new Set<string>()
    const ytUrl = '(?:https?:\\/\\/)?(?:www\\.)?(?:youtube\\.com\\/watch\\?v=[\\w-]+|youtu\\.be\\/[\\w-]+)'
    // Prefer "Title — URL" / "Title - URL" / "[Title](URL)" so we keep titles.
    const labelled = new RegExp(`(?:\\[([^\\]]+)\\]\\((${ytUrl})\\)|([^\\n—\\-]+?)\\s*[—-]\\s*(${ytUrl}))`, 'g')
    let m: RegExpExecArray | null
    while ((m = labelled.exec(g.text)) !== null) {
      const title = (m[1] ?? m[3] ?? '').trim()
      let link = (m[2] ?? m[4] ?? '').trim()
      if (!link.startsWith('http')) link = `https://${link}`
      if (seen.has(link)) continue
      seen.add(link)
      videos.push({ title, link })
    }
    // Catch any bare URLs we missed.
    const bare = new RegExp(ytUrl, 'g')
    while ((m = bare.exec(g.text)) !== null) {
      let link = m[0]
      if (!link.startsWith('http')) link = `https://${link}`
      if (seen.has(link)) continue
      seen.add(link)
      videos.push({ title: '', link })
    }
    if (videos.length > 0) return JSON.stringify({ videos: videos.slice(0, n) })
  }

  // Nothing playable found. Signal not_found so Kelion says so in his own voice —
  // NOT a YouTube results-page URL, which refuses to embed and breaks playback
  // (that was the "voice fails when the song isn't found" case).
  return JSON.stringify({ videos: [], not_found: true })
}

// Real YouTube resolver for the [YT query] bridge tag: searches (Serper first,
// Gemini fallback) and returns the top playable video as an embeddable URL.
// The brain must NEVER guess a video ID — it emits [YT query] and the server
// resolves a real, currently-available ID so the embed always plays.
export async function youtubeFirstEmbed(
  query: string,
): Promise<{ embed: string; watch: string; title: string } | null> {
  const raw = await youtubeSearch(query, 1)
  let parsed: { videos?: { title?: string; link?: string }[] }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const link = parsed.videos?.[0]?.link ?? ''
  const title = parsed.videos?.[0]?.title ?? ''
  const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(link)
  if (!m) return null
  const id = m[1]
  return { embed: `https://www.youtube.com/embed/${id}?autoplay=1`, watch: link, title }
}

async function translateText(text: string, target: string): Promise<string> {
  if (!text || !target) return JSON.stringify({ error: 'missing_text_or_target' })
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
  return JSON.stringify({ translation: out ?? '', target })
}

// TRADUCERE ÎN BLOC (Adrian, 10 iul: „buton care traduce în română instant din
// orice limbă" — în vizualizarea conversațiilor din admin). Traduce un ȘIR de
// mesaje în `target`, în paralel; dacă o traducere eșuează (Gemini neconfigurat
// sau eroare), întoarce textul ORIGINAL pentru acel mesaj, nu se pierde nimic.
export async function translateMany(texts: string[], target: string): Promise<string[]> {
  return Promise.all(
    texts.map(async (t) => {
      const s = (t ?? '').trim()
      if (!s) return t ?? ''
      try {
        const r = await translateText(s, target)
        const j = JSON.parse(r) as { translation?: string }
        return j.translation && j.translation.trim() ? j.translation : (t ?? '')
      } catch {
        return t ?? ''
      }
    }),
  )
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
      const sr = await tfetch(s, { headers: { 'User-Agent': OSM_UA } })
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
    const r = await tfetch(u, { headers: { 'User-Agent': OSM_UA } })
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
    else if (name === 'send_email')
      result = await sendEmail(str(args.to), str(args.subject), str(args.body), token)
    else if (name === 'create_calendar_event')
      result = await createCalendarEvent(str(args.summary), str(args.start), str(args.end), str(args.location), token)
    else if (name === 'get_drive_files') result = await driveFiles(str(args.query), num(args.max_results, 10), token)
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
