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
]

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

export async function runGoogleTool(
  name: string,
  input: unknown,
  token: string,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>
  try {
    // web_search uses Serper, not the user's Google token.
    if (name === 'web_search') return await webSearch(str(args.query), num(args.max_results, 5))

    if (!token) {
      return JSON.stringify({
        error: 'no_google_access — ask the user to sign in again to grant access.',
      })
    }
    if (name === 'get_calendar_events') return await calendarEvents(num(args.max_results, 10), token)
    if (name === 'get_recent_emails')
      return await recentEmails(str(args.query), num(args.max_results, 5), token)
    return JSON.stringify({ error: 'unknown_tool' })
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'tool_failed' })
  }
}
