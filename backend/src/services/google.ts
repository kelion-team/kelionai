import type Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

// Google skills exposed to Claude as tools. Claude decides when to call them;
// the backend executes the Google REST API with the user's OAuth access token
// and returns the result. Add a new skill = add a tool def + a case in
// runGoogleTool (generic framework — cheap to extend to Drive, Maps, etc.).

export const googleTools: Anthropic.Tool[] = [
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
      'Search the live web for current, real information (news, facts, prices, anything recent). Use whenever the answer depends on up-to-date or external information you do not already know.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max_results: { type: 'number', description: 'How many results (default 5, max 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather',
    description:
      'Get the current weather and a short multi-day forecast for a place (city name). Use for any weather question.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name, e.g. "Bucharest" or "Witney, UK".' },
      },
      required: ['location'],
    },
  },
  {
    name: 'send_email',
    description:
      "Send an email from the user's Gmail account. Confirm the recipient and content with the user before sending if there is any doubt.",
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'Email body (plain text).' },
      },
      required: ['to', 'body'],
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
    const res = await fetch('https://oauth2.googleapis.com/token', {
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

// Best-effort reverse geocode (device GPS → human place name) so Claude knows
// where "here" is. Keyless OpenStreetMap Nominatim; short timeout, never throws.
// Cached by ~100 m (3 decimals) so only the first chat turn at a location pays
// the network cost — keeps the chat hot path low-latency.
const geoCache = new Map<string, string>()
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = geoCache.get(key)
  if (hit !== undefined) return hit
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse')
    u.searchParams.set('lat', String(lat))
    u.searchParams.set('lon', String(lon))
    u.searchParams.set('format', 'json')
    u.searchParams.set('zoom', '14')
    const res = await fetch(u, {
      headers: { 'User-Agent': 'KelionAI/1.0 (kelionai.app)' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return ''
    const j = (await res.json()) as { display_name?: string }
    const name = j.display_name ?? ''
    geoCache.set(key, name)
    return name
  } catch {
    return ''
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (!listRes.ok) return JSON.stringify({ error: `gmail_http_${listRes.status}` })
  const list = (await listRes.json()) as { messages?: { id: string }[] }
  const ids = (list.messages ?? []).slice(0, n)
  const emails: { from: string; subject: string; date: string; snippet: string }[] = []
  for (const { id } of ids) {
    const mUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
    const mRes = await fetch(mUrl, { headers: { Authorization: `Bearer ${token}` } })
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
}

async function webSearch(query: string, max: number): Promise<string> {
  if (!config.serperKey) return JSON.stringify({ error: 'search_not_configured' })
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query }),
  })
  if (!res.ok) return JSON.stringify({ error: `search_http_${res.status}` })
  const j = (await res.json()) as { organic?: SerperResult[]; answerBox?: { answer?: string; snippet?: string } }
  const n = Math.min(Math.max(max, 1), 10)
  const results = (j.organic ?? []).slice(0, n).map((r) => ({
    title: r.title ?? '',
    link: r.link ?? '',
    snippet: r.snippet ?? '',
  }))
  const answer = j.answerBox?.answer ?? j.answerBox?.snippet ?? ''
  return JSON.stringify({ answer, results })
}

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm w/ hail', 99: 'thunderstorm w/ hail',
}

async function weather(location: string): Promise<string> {
  if (!location) return JSON.stringify({ error: 'empty_location' })
  // Open-Meteo: free, keyless geocoding + forecast.
  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
  geoUrl.searchParams.set('name', location)
  geoUrl.searchParams.set('count', '1')
  const geoRes = await fetch(geoUrl)
  if (!geoRes.ok) return JSON.stringify({ error: `geo_http_${geoRes.status}` })
  const geo = (await geoRes.json()) as {
    results?: { latitude: number; longitude: number; name: string; country?: string }[]
  }
  const place = geo.results?.[0]
  if (!place) return JSON.stringify({ error: 'location_not_found' })
  const wUrl = new URL('https://api.open-meteo.com/v1/forecast')
  wUrl.searchParams.set('latitude', String(place.latitude))
  wUrl.searchParams.set('longitude', String(place.longitude))
  wUrl.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m')
  wUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code')
  wUrl.searchParams.set('forecast_days', '3')
  wUrl.searchParams.set('timezone', 'auto')
  const wRes = await fetch(wUrl)
  if (!wRes.ok) return JSON.stringify({ error: `weather_http_${wRes.status}` })
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
  return JSON.stringify({
    location: `${place.name}${place.country ? ', ' + place.country : ''}`,
    current: c
      ? { temp_c: c.temperature_2m, condition: code(c.weather_code), wind_kmh: c.wind_speed_10m, humidity_pct: c.relative_humidity_2m }
      : null,
    forecast,
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
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
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
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `tasks_http_${res.status}` })
  const j = (await res.json()) as { items?: { title?: string; due?: string; status?: string }[] }
  const tasks = (j.items ?? []).map((t) => ({ title: t.title ?? '', due: t.due ?? '', status: t.status ?? '' }))
  return JSON.stringify({ tasks })
}

async function addTask(title: string, due: string, token: string): Promise<string> {
  if (!title) return JSON.stringify({ error: 'missing_title' })
  const body: { title: string; due?: string } = { title }
  if (due && !Number.isNaN(Date.parse(due))) body.due = new Date(due).toISOString()
  const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return JSON.stringify({ error: `tasks_add_http_${res.status}` })
  return JSON.stringify({ added: true, title })
}

interface PersonName { displayName?: string }
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return JSON.stringify({ error: `contacts_http_${res.status}` })
  const j = (await res.json()) as { results?: { person?: Person }[] }
  const contacts = (j.results ?? []).map((r) => ({
    name: r.person?.names?.[0]?.displayName ?? '',
    email: r.person?.emailAddresses?.[0]?.value ?? '',
    phone: r.person?.phoneNumbers?.[0]?.value ?? '',
  }))
  return JSON.stringify({ contacts })
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
  const res = await fetch(u, { headers: { 'User-Agent': OSM_UA } })
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
  const res = await fetch(u, { headers: { 'User-Agent': OSM_UA } })
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

async function mapsDirections(origin: string, destination: string): Promise<string> {
  if (!origin || !destination) return JSON.stringify({ error: 'missing_origin_or_destination' })
  const [a, b] = await Promise.all([geocodeOne(origin), geocodeOne(destination)])
  if (!a?.lat || !b?.lat) return JSON.stringify({ error: 'could_not_geocode' })
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`
  const res = await fetch(url)
  if (!res.ok) return JSON.stringify({ error: `directions_http_${res.status}` })
  const j = (await res.json()) as { routes?: { distance?: number; duration?: number }[] }
  const r = j.routes?.[0]
  if (!r) return JSON.stringify({ error: 'no_route' })
  return JSON.stringify({
    origin: a.display_name ?? origin,
    destination: b.display_name ?? destination,
    distance_km: Math.round((r.distance ?? 0) / 100) / 10,
    duration_min: Math.round((r.duration ?? 0) / 60),
  })
}

async function youtubeSearch(query: string, max: number): Promise<string> {
  if (!config.serperKey) return JSON.stringify({ error: 'search_not_configured' })
  if (!query) return JSON.stringify({ error: 'empty_query' })
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: `${query} site:youtube.com` }),
  })
  if (!res.ok) return JSON.stringify({ error: `youtube_http_${res.status}` })
  const j = (await res.json()) as { organic?: SerperResult[] }
  const n = Math.min(Math.max(max, 1), 10)
  const videos = (j.organic ?? [])
    .filter((r) => (r.link ?? '').includes('youtube.com/watch') || (r.link ?? '').includes('youtu.be/'))
    .slice(0, n)
    .map((r) => ({ title: r.title ?? '', link: r.link ?? '' }))
  return JSON.stringify({ videos })
}

async function translateText(text: string, target: string): Promise<string> {
  if (!text || !target) return JSON.stringify({ error: 'missing_text_or_target' })
  if (!config.geminiKey) return JSON.stringify({ error: 'translate_not_configured' })
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`
  const res = await fetch(url, {
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

export async function runGoogleTool(
  name: string,
  input: unknown,
  token: string,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>
  try {
    // These don't use the user's Google token.
    if (name === 'web_search') return await webSearch(str(args.query), num(args.max_results, 5))
    if (name === 'get_weather') return await weather(str(args.location))
    if (name === 'maps_search') return await mapsSearch(str(args.query), num(args.max_results, 5))
    if (name === 'maps_directions')
      return await mapsDirections(str(args.origin), str(args.destination))
    if (name === 'youtube_search') return await youtubeSearch(str(args.query), num(args.max_results, 5))
    if (name === 'translate_text') return await translateText(str(args.text), str(args.target))

    if (!token) {
      return JSON.stringify({
        error: 'no_google_access — ask the user to sign in again to grant access.',
      })
    }
    if (name === 'get_calendar_events') return await calendarEvents(num(args.max_results, 10), token)
    if (name === 'get_recent_emails')
      return await recentEmails(str(args.query), num(args.max_results, 5), token)
    if (name === 'send_email')
      return await sendEmail(str(args.to), str(args.subject), str(args.body), token)
    if (name === 'create_calendar_event')
      return await createCalendarEvent(str(args.summary), str(args.start), str(args.end), str(args.location), token)
    if (name === 'get_drive_files') return await driveFiles(str(args.query), num(args.max_results, 10), token)
    if (name === 'get_tasks') return await getTasks(num(args.max_results, 20), token)
    if (name === 'add_task') return await addTask(str(args.title), str(args.due), token)
    if (name === 'search_contacts')
      return await searchContacts(str(args.query), num(args.max_results, 5), token)
    return JSON.stringify({ error: 'unknown_tool' })
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'tool_failed' })
  }
}
