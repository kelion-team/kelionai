// Collect client-side console errors and unhandled exceptions and forward them
// to the backend. This is the evidence sink Adrian asked for before debugging
// camera issues in low light.

interface ClientErrorReport {
  type: 'error' | 'unhandledrejection' | 'console-error' | 'console-warn'
  message: string
  stack?: string
  url: string
  ts: number
}

const KEY = '__kelion_client_errors__'
const MAX_STORED = 50
const MAX_PAYLOAD = 1200
const POST_URL = '/api/bridge/client-errors'

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function currentReports(): ClientErrorReport[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : []
    return Array.isArray(parsed)
      ? parsed.filter((r): r is ClientErrorReport => typeof r === 'object' && r !== null && 'message' in r)
      : []
  } catch {
    return []
  }
}

function storeReport(r: ClientErrorReport): void {
  try {
    const list = [...currentReports(), r]
    while (list.length > MAX_STORED) list.shift()
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* localStorage may be unavailable in private/incognito mode */
  }
}

function send(report: ClientErrorReport): void {
  const body: ClientErrorReport = {
    ...report,
    message: truncate(report.message, 400),
    stack: report.stack ? truncate(report.stack, 600) : undefined,
  }
  if (navigator.sendBeacon) {
    try {
      navigator.sendBeacon(POST_URL, JSON.stringify(body))
      return
    } catch {
      /* fall through to fetch */
    }
  }
  void fetch(POST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

let lastFlush = 0
function flush(): void {
  const now = Date.now()
  if (now - lastFlush < 5000) return
  lastFlush = now
  const reports = currentReports()
  if (reports.length === 0) return
  const payload = truncate(JSON.stringify(reports.slice(-10)), MAX_PAYLOAD)
  void fetch(POST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batch: payload }),
    keepalive: true,
  }).catch(() => {})
}

export function reportError(type: ClientErrorReport['type'], message: string, stack?: string): void {
  const report: ClientErrorReport = {
    type,
    message,
    stack,
    url: typeof location !== 'undefined' ? location.href : '',
    ts: Date.now(),
  }
  storeReport(report)
  send(report)
}

export function initErrorReporting(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (e) => {
    reportError('error', e.message, e.error instanceof Error ? e.error.stack : undefined)
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    reportError('unhandledrejection', message, stack)
  })

  const origError = console.error
  console.error = (...args: unknown[]) => {
    origError.apply(console, args)
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
    if (text) reportError('console-error', text)
  }

  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    origWarn.apply(console, args)
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
    if (text) reportError('console-warn', text)
  }

  // Flush any errors that accumulated while offline on the next opportunity.
  window.addEventListener('online', flush)
}
