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

// ZGOMOT BENIGN, NU BUG (Adrian, 12 iul: „reparară o fantomă — consumă credite,
// bani; corectează-i ce trebuie să știe"). Un AVERTISMENT de browser (o funcție
// depreciată, o violare de performanță, un observer care buclează) NU e o eroare
// de reparat. Raportat, se aduna și arata ca un bug — creierul pornea o reparație
// costisitoare pentru ceva ce NU e stricat. Aici le tăiem înainte să plece: doar
// erorile reale (excepții, respingeri, console.error real) ajung la server.
const BENIGN = /\bis deprecated\b|deprecat|will be removed|has been deprecated|ScriptProcessorNode|AudioWorkletNode|createScriptProcessor|\[Violation\]|non-passive event listener|passive event listener|ResizeObserver loop|Download the React DevTools|chrome-extension:\/\//i

function isBenign(text: string): boolean {
  return BENIGN.test(text)
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
  // Avertismentele de consolă benigne (deprecări, violări de performanță) nu sunt
  // bug-uri — nu le trimite, ca să nu declanșeze reparații-fantomă. Erorile reale
  // (excepții JS, respingeri de promisiuni) trec MEREU, indiferent de text.
  if ((type === 'console-warn' || type === 'console-error') && isBenign(message)) return
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

const DIAG_URL = '/api/bridge/audio-diagnostic'
const audioDiagQueue: Record<string, unknown>[] = []
let audioDiagTimer: number | null = null
let lastAudioDiag = 0

export function reportAudioDiagnostic(payload: Record<string, unknown>): void {
  audioDiagQueue.push(payload)
  if (audioDiagTimer !== null) return
  audioDiagTimer = window.setTimeout(() => {
    audioDiagTimer = null
    const now = Date.now()
    if (now - lastAudioDiag < 500) return // max ~2 rapoarte/secundă per fereastră
    const batch = audioDiagQueue.splice(0, audioDiagQueue.length)
    if (batch.length === 0) return
    // trimite ultimul raport din coadă (cel mai recent); restul sunt istoric redundat
    const report = batch[batch.length - 1]
    lastAudioDiag = now
    void fetch(DIAG_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => {})
  }, 250)
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
