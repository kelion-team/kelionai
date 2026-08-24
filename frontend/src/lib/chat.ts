export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** When it was sent (epoch ms) — shown as a time next to each message. */
  ts?: number
}

import { apiFetch } from './transport'

export interface Coords {
  lat: number
  lon: number
}

// Control commands Kelion can push on the stream (stripped from the visible
// text; never shown or spoken). Currently: drive the monitor surface.
// A structured "skill card" Kelion renders on the monitor (emails, calendar,
// tasks, Drive files, contacts, web results). One generic shape for all types.
export interface CardItem {
  primary: string
  secondary?: string
  meta?: string
  url?: string
}
export interface SkillCard {
  type: string
  title: string
  items: CardItem[]
}

export interface ChatControl {
  monitor?: { url: string; title: string }
  // Nivelurile de trading extrase de SERVER din răspuns (parserul testat, cu
  // prețul real) — ChatPanel le pasează în iframe-ul Centrului, care le
  // desenează pe grafic (10 aug: chatul REAL, conștient de pagina de trading).
  niveluri?: { simbol: string; lista: { nume: string; valoare: number }[] }
  // POINTERI de indicație pe grafic (unealta arata_pe_grafic, 10 aug): fiecare e
  // o linie colorată cu săgeată + eticheta cu vorbele lui Kelion, desenată fix pe
  // preț — „când explică, arată clar pe monitor ce zice". ChatPanel le pasează în
  // iframe-ul Centrului de Tranzacționare, care le desenează.
  semne?: {
    simbol: string
    lista: { pret: number; tip: string; text: string }[]
    // ZONE (benzi de preț), SĂGEȚI (pe lumânări) și TREND (linie prin 2 prețuri) —
    // desenate de aceeași unealtă arata_pe_grafic, pe același canal.
    zone?: { jos: number; sus: number; tip: string; text: string }[]
    sageti?: { directie: string; unde: string; text: string }[]
    trend?: { pret1: number; pret2: number; text: string }[]
  }
  // A generated image to show inline in the chat (in addition to the monitor).
  image?: { url: string }
  // A structured skill result to render as a card on the monitor.
  card?: SkillCard
  // A readable text deliverable from an agent (email, translation, findings),
  // shown as a copyable panel on the monitor.
  doc?: { title: string; text: string }
  // A COMPLETE web page written by Kelion (run_web_app) — runs live on the
  // monitor in an isolated frame (srcdoc + sandbox) and can be saved as .html.
  app?: { title: string; html: string }
  // THE CONSTRUCTOR PANEL (Stage 4b): opens on the monitor the live display of
  // build orders — subscribes to /api/constructor/live and shows
  // Taken→current step→Done/Failed. Emitted when Kelion takes a build order.
  build?: { open?: boolean; title?: string }
  // A device command the SERVER interpreted (camera / monitor tabs) — the
  // regexes moved off the browser; the client just executes what this says.
  device?: {
    camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
    screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
  }
  // The server committed a new speech language (detected + persisted there);
  // the client applies it to the recognizer and mirrors it locally.
  lang?: string
  // ACCESS TO THE APP TABS from the written chat (the open_app_view tool):
  // the client translates into the kelion:navigate event; Stage opens the panel.
  nav?: { view: string; section?: string }
  // Out of credit — the client should open the top-up (buy credit) flow.
  paywall?: boolean
  // A heartbeat from the server while the brain thinks (nothing to show) — keeps
  // the connection open through Cloudflare and feeds the watchdog below.
  ping?: number
  // The server has received the message — the delivery check mark in the UI.
  receipt?: boolean
  // GESTURE ON COMMAND: the clip name from the movement direction (AvatarModel)
  // the brain requests via the [GEST name] tag — the avatar plays it once.
  gest?: string
  // Eticheta tool-ului server-side play_avatar_gesture (release v2.3) —
  // ChatPanel translates it into the equivalent RPM clip, on the same gesture channel.
  gesture?: string
  // TRANSCRIPT AT THE BRAIN'S ENTRANCE (Adrian, Jul 10): the EXACT text the
  // server hands to the brain this turn — sent from the server, not a
  // local echo. Shown as a distinct band, so you can see what it "heard".
  // VOCE UNIFICATĂ (5 aug): pe o tură vocală, `heard` = ce a auzit CREIERUL
  // (transcript precis, din voce) — clientul umple bula userului cu el.
  heard?: string
  // VOCE AMBIENTALĂ: creierul a decis că NU i se vorbea → tura se stinge; clientul
  // șterge bulele optimiste și nu redă nimic (Adrian: „să nu vorbească neîntrebat").
  ignored?: boolean
  golesteMonitor?: boolean
  clickMonitor?: { x: number; y: number }
  // EXECUȚIA PAS CU PAS (owner, 14 aug): fiecare unealtă chemată pe o tură de
  // execuție = un pas anunțat live; bara de punctulețe de pe monitor îl arată.
  // gata=true vine o singură dată, la închiderea REALĂ a turei (100%).
  executie?: { pas: string; procent: number; gata?: boolean }
  /** The durable retry was safely restarted because no external effect began. */
  replayRestarted?: boolean
  scenariu?: { videoPrompt: string; nume: string; cale: 'openai' }
  zoomMonitor?: { level?: number; direction?: string }
  // MESSENGER KELION↔KELION (Adrian, 11 aug): „apelează-l pe X" → creierul a pornit
  // un apel; frame-ul ăsta ridică la APELANT interfața „sun pe…". Celălalt primește
  // invitația pe WS-ul lui de prezență (lib/apel.ts). Permis și în modul mașină.
  apel?: { stare: string; callId?: string; cu?: { email: string; nume: string } }
  // Vocea răspunsului: MP3 sintetizat server-side prin motorul OpenAI și trimis prin
  // the bridge. The app only decodes + plays it — it synthesizes nothing locally.
  audio?: string
  // Owner promo pipeline: an APPROVED clip script + shot list — arm the recorder;
  // when recording starts the script is spoken (voice only, no text on screen)
  // while the scenes appear on the monitor at their times.
  promo?: {
    subject: string
    duration: number
    script: string
    // The script's own language (BCP-47/2-letter) — the clip is narrated in it
    // so the voice always matches the text (a mismatch is what silenced it).
    lang?: string | null
    scenes?: { at: number; title: string; url?: string; close?: boolean }[]
  }
}

import { getStareTranzactii, getMonitorContent } from './workspace'
import { getTeava } from './retea'

// U+001F (unit separator) brackets a JSON control frame in the text stream.
const CTRL = String.fromCharCode(31)

// POST the conversation to the backend and yield streamed text chunks.
// `image` (base64 JPEG data URL) is the latest camera frame for the brain's vision.
// `coords` is the live device GPS so location-dependent skills work.
// `onControl` receives any control frames Kelion emits (e.g. open the monitor).
// A snapshot of the monitor tabs currently open, sent with each turn so Kelion
// knows what it's already showing (and which surface is active) — it works inside
// whichever task is active and swaps content instead of re-opening.
export interface ScreenTask {
  kind: string
  title: string
  active: boolean
}

function chatIdempotencyKey(requested?: string): string {
  return requested && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requested)
    ? requested
    : crypto.randomUUID()
}

// ── THE HONEST CONNECTION VERDICT (Adrian, 2 aug: „raportează fals că pierde
// conexiunea la net — trebuie monitorizat real dacă e așa") ─────────────────
// Before, ANY failed fetch/stream became 'offline' → the chat told the human
// „I've lost the internet connection" with ZERO measurement — including when
// OUR server was restarting (a deploy!) while his internet was perfectly
// fine. A failed read presented as an established fact, rule no. 1 broken.
// Now the claim is MEASURED, and the verdict is logged (console.error reaches
// the server through the F12 pipe — the real monitoring he asked for):
//   'offline'     → the BROWSER itself says the machine has no network;
//   'server_down' → the network is up but /api/health doesn't answer
//                   (deploy/restart/crash — NOT the user's internet);
//   'transient'   → network up AND the server answers: only this one request
//                   broke on the road (proxy hiccup, dropped socket).
async function diagnozaConexiune(): Promise<'offline' | 'server_down' | 'transient'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    console.error('[CONEXIUNE] verdict măsurat: offline (navigator.onLine=false)')
    return 'offline'
  }
  try {
    const r = await apiFetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    const verdict = r.ok ? 'transient' : 'server_down'
    console.error(`[CONEXIUNE] verdict măsurat: ${verdict} (net OK, /api/health → ${r.status})`)
    return verdict
  } catch {
    console.error('[CONEXIUNE] verdict măsurat: server_down (net OK, /api/health nu răspunde)')
    return 'server_down'
  }
}

export async function* streamChat(
  messages: ChatMessage[],
  image?: string,
  coords?: Coords,
  onControl?: (c: ChatControl) => void,
  screen?: ScreenTask[],
  // STOP: abandon signal — "stop" typed/spoken cuts the turn AT ONCE (not queued).
  signal?: AbortSignal,
  // The picture was EXPLICITLY ATTACHED (pasted with Ctrl+V or uploaded) — an
  // unambiguous analysis request, unlike the always-on camera frame (which
  // is analyzed only on explicit request in text). See ChatPanel.tsx.
  imageIsAttachment?: boolean,
  // THE SPOKEN TURN (Aug 1 — one brain): this message came from the live voice
  // session's ears. The server shapes the reply for speech (clean sentences,
  // no markdown tables/links) — the client speaks it verbatim through the
  // voice session's mouth. Typed turns omit the flag.
  spoken?: boolean,
  // AUDIO NATIV → CREIER (Adrian, 3 aug: „deep learning legat de creier direct"):
  // vocea brută a frazei (WAV data-URI), transmisă creierului OpenAI.
  audio?: string,
  // VOCE AMBIENTALĂ (Adrian, 5 aug: „tot decis de creierul unic"): tura a venit din
  // ascultarea continuă, fără poartă de nume pe client — creierul aude audio-ul și
  // decide SINGUR dacă i se vorbește; dacă nu, tace ({ignored}). Doar pe voce.
  voceAmbianta?: boolean,
  // MODUL MAȘINĂ (Adrian, 11 aug; rescris 13 aug): tura vine din stratul de mașină.
  // Serverul răspunde SCURT, voce-first — dar NU mai suprimă suprafețe: ce spune că
  // face, execută (owner: „vorbă = faptă").
  carMode?: boolean,
  // Un request offline amânat refolosește UUID-ul persistent la fiecare retry.
  durableRequestId?: string,
): AsyncGenerator<string> {
  // Aceeași cheie este refolosită dacă fluxul trebuie redeschis, astfel încât
  // serverul să nu debiteze aceeași tură de două ori.
  const idempotencyKey = chatIdempotencyKey(durableRequestId)

  // Deduplication set: a reconnect may re-send events we already processed.
  const seenIds = new Set<string>()
  let lastEventId = ''
  let turnId: string | null = null
  let resumeTries = 0
  let claimPolls = 0
  let retryingDurableClaim = false
  let terminalReplay = false
  let terminalReplayText = ''
  let deliveredText = ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let decoder = new TextDecoder()
  let sseBuf = '' // raw SSE text buffer, split on \n\n
  let textBuf = '' // visible text + control frames buffer, split on CTRL

  // Parse fully-delimited SSE events from the accumulated buffer. Returns the
  // parsed events and the leftover incomplete text.
  function parseSSE(chunk: string): { id?: string; data?: string }[] {
    sseBuf += chunk
    const events: { id?: string; data?: string }[] = []
    for (;;) {
      const end = sseBuf.indexOf('\n\n')
      if (end === -1) break
      const block = sseBuf.slice(0, end)
      sseBuf = sseBuf.slice(end + 2)
      let id: string | undefined
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim()
        else if (line.startsWith('data:')) {
          // SSE spec: if ONE space follows "data:", that space is part
          // of the framing and gets removed (the server writes "data: <chunk>"). WITHOUT this,
          // every token came with a leading space and the words shattered —
          // „detaliat" (token-urile det/ali/at) → „det ali at" (bug raportat de
          // Adrian). EXACTLY one space is removed, so the text's real spaces stay.
          let v = line.slice(5)
          if (v.startsWith(' ')) v = v.slice(1)
          dataLines.push(v)
        }
        // comment lines (heartbeat) and other fields are ignored
      }
      if (id !== undefined || dataLines.length > 0) {
        events.push({ id, data: dataLines.join('\n') })
      }
    }
    return events
  }

  // Split the accumulated text buffer into visible text (yielded) and control
  // frames (parsed), holding back any partial frame until its closing separator.
  function drain(final: boolean): string {
    let out = ''
    for (;;) {
      const i = textBuf.indexOf(CTRL)
      if (i === -1) {
        out += textBuf
        textBuf = ''
        break
      }
      out += textBuf.slice(0, i)
      const j = textBuf.indexOf(CTRL, i + 1)
      if (j === -1) {
        // Incomplete frame. Keep it (unless this is the final flush — then drop).
        textBuf = final ? '' : textBuf.slice(i)
        break
      }
      const json = textBuf.slice(i + 1, j)
      // desync propagates OUTSIDE the try (Jul 25): thrown inside, it was
      // swallowed by the "malformed frame" catch and the fresh-turn mechanism
      // described below never fired.
      let desynced = false
      try {
        const frame = JSON.parse(json) as ChatControl & {
          turn?: string
          desync?: boolean
          replayed?: boolean
        }
        if (typeof frame.turn === 'string') {
          turnId = frame.turn
          if (retryingDurableClaim) {
            retryingDurableClaim = false
            if (frame.replayed === true) {
              terminalReplay = true
            } else {
              deliveredText = ''
              onControl?.({ replayRestarted: true })
            }
          }
          // The {turn} frame is the FIRST thing the server sends — it doubles as
          // proof of receipt: the message reached the server (delivery check).
          onControl?.({ receipt: true })
        } else if (frame.desync) {
          // Server ring buffer overflowed: we can no longer resume this turn.
          turnId = null
          desynced = true
        } else {
          onControl?.(frame)
        }
      } catch {
        /* malformed control frame — ignore */
      }
      textBuf = textBuf.slice(j + 1)
      if (desynced) throw new Error('desync')
    }
    return out
  }

  async function openStream(): Promise<void> {
    let res: Response
    try {
      if (turnId && lastEventId) {
        // Reconnect after a drop: resume the same turn from the last seen id.
        res = await apiFetch(
          `/api/chat/resume?turn=${encodeURIComponent(turnId)}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { 'Last-Event-ID': lastEventId },
            signal,
          },
        )
      } else {
        res = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal,
          body: JSON.stringify({
            idempotencyKey,
            messages,
            image,
            imageIsAttachment,
            imageSource: imageIsAttachment ? 'chat' : 'camera',
            coords,
            screen,
            // Conținutul REAL al tabului activ (10 aug: „nu are acces la ce se
            // afișează pe monitor") — get_monitor îl întoarce brainului.
            monitorContent: getMonitorContent() ?? undefined,
            // Ancora Centrului de Tranzacționare, cât tabul e deschis (10 aug):
            // creierul răspunde pe CIFRELE de pe ecran, nu din burtă.
            tranzactii: getStareTranzactii() ?? undefined,
            // ȚEAVA DE REȚEA (12 aug, owner: „test care vede ce țeavă se
            // folosește"): treapta detectată, ca să poți întreba „ce țeavă am?"
            // și Kelion să răspundă REAL + să-și scurteze răspunsul pe țeavă slabă.
            retea: getTeava(),
            spoken: spoken || undefined,
            audio,
            voceAmbianta: voceAmbianta || undefined,
            carMode: carMode || undefined,
            now: new Date().toISOString(),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        })
      }
    } catch (e) {
      // ABORT IS NOT "OFFLINE" (Adrian, Jul 31: "hears the second question, briefly
      // shows it, but doesn't pass it on to the brain" + "the message that technically it
      // appeared again").
      // Here the second question got lost. When you type something NEW while Kelion is still
      // replying, the old turn is intentionally aborted (barge-in, ChatPanel:823).
      // This catch swallowed the abort and reported it as `offline` — and `offline`
      // starts the resume mechanism: marks the session fallen, remembers
      // the text, and on the next `online` signal DELETES THE LAST TWO MESSAGES
      // (ChatPanel:1588) and resends. After a barge-in, the last two messages are
      // exactly your new question and its in-progress reply. That's why you saw it for a
      // moment and it disappeared, with ⚠️ on top.
      // A human-requested cancellation is not a network failure and doesn't get repaired.
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw new Error('aborted')
      throw new Error(await diagnozaConexiune())
    }

    if (!res.ok || !res.body) {
      // Map real HTTP/API failures to stable codes so ChatPanel can show the
      // right recovery path (auth / paywall / rate limit) instead of a false
      // generic "brain error" on every non-200.
      let code = 'error'
      let retryAfterMs = 0
      try {
        const j = (await res.json()) as { error?: string; retryAfterMs?: number }
        if (typeof j.error === 'string' && j.error.trim()) code = j.error.trim()
        else if (res.status === 401 || res.status === 403) code = 'unauthorized'
        else if (res.status === 402) code = 'paywall'
        else if (res.status === 429) code = 'rate_limited'
        else if (res.status >= 500) code = 'server_down'
        if (Number.isFinite(j.retryAfterMs)) retryAfterMs = Number(j.retryAfterMs)
      } catch {
        if (res.status === 401 || res.status === 403) code = 'unauthorized'
        else if (res.status === 402) code = 'paywall'
        else if (res.status === 429) code = 'rate_limited'
        else if (res.status >= 500) code = 'server_down'
      }
      // The first POST may have reached the server even if its first byte did
      // not reach us. Poll the SAME durable UUID until its lease publishes a
      // terminal replay; never manufacture a second logical turn.
      if (code === 'turn_in_progress' && !turnId && claimPolls < 120) {
        claimPolls++
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            window.clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          }
          const timer = window.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }, Math.max(250, Math.min(5_000, retryAfterMs || 750)))
          if (signal?.aborted) {
            window.clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', onAbort, { once: true })
        })
        return openStream()
      }
      throw new Error(code)
    }

    reader = res.body.getReader()
    decoder = new TextDecoder()
  }

  // Reconnect to the resume endpoint after a drop; returns true if a fresh
  // reader was opened. Uses Last-Event-ID so the server replays only missing events.
  async function resume(): Promise<boolean> {
    if (!turnId || !lastEventId || resumeTries >= 6) return false
    resumeTries++
    await new Promise((r) => setTimeout(r, Math.min(4000, 400 * resumeTries)))
    try {
      if (reader) await reader.cancel()
    } catch {
      /* reader already dead */
    }
    try {
      await openStream()
      return true
    } catch {
      return false
    }
  }

  await openStream()

  const livreazaText = (text: string): string => {
    if (!text) return ''
    if (terminalReplay) {
      terminalReplayText += text
      return ''
    }
    deliveredText += text
    return text
  }

  // WATCHDOG: a dead-but-"open" connection never throws from
  // read() — the turn stayed blocked forever. The server pulses a heartbeat every
  // ≤15s, so 50s without ANY byte = certainly dead thread → resume, and if even
  // that fails, the turn closes ('offline') and the chat unblocks.
  const READ_SILENCE_MS = 50_000
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    let watchdog: number | undefined
    try {
      chunk = await Promise.race([
        reader!.read(),
        new Promise<never>((_, rej) => {
          watchdog = window.setTimeout(() => rej(new Error('silent')), READ_SILENCE_MS)
        }),
      ])
    } catch (e) {
      // As above: an intentionally aborted turn (barge-in / "stop") doesn't
      // reconnect and isn't declared offline — its stop was requested.
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw new Error('aborted')
      if (await resume()) continue
      // The in-memory SSE ring may be gone after a process restart. Reclaim or
      // replay the SAME durable UUID through the persistent turn registry.
      turnId = null
      lastEventId = ''
      seenIds.clear()
      sseBuf = ''
      textBuf = ''
      terminalReplay = false
      terminalReplayText = ''
      retryingDurableClaim = true
      await openStream()
      continue
    } finally {
      window.clearTimeout(watchdog)
    }
    if (chunk.done) break
    const text = decoder.decode(chunk.value, { stream: true })
    const events = parseSSE(text)
    for (const ev of events) {
      if (ev.id) {
        if (seenIds.has(ev.id)) continue
        seenIds.add(ev.id)
        lastEventId = ev.id
      }
      if (ev.data !== undefined) {
        textBuf += ev.data
        const out = livreazaText(drain(false))
        if (out) yield out
      }
    }
  }
  // Flush any partial SSE event and any trailing control frame.
  const events = parseSSE('\n\n')
  for (const ev of events) {
    if (ev.id && !seenIds.has(ev.id)) {
      seenIds.add(ev.id)
      lastEventId = ev.id
    }
    if (ev.data !== undefined) textBuf += ev.data
  }
  textBuf += decoder.decode()
  const tail = livreazaText(drain(true))
  if (tail) yield tail
  if (terminalReplay) {
    if (terminalReplayText.startsWith(deliveredText)) {
      const missing = terminalReplayText.slice(deliveredText.length)
      if (missing) yield missing
    } else if (!deliveredText.startsWith(terminalReplayText)) {
      // The retained terminal text does not share the delivered prefix. Let the
      // caller replace the abandoned partial response instead of concatenating
      // two different generations.
      onControl?.({ replayRestarted: true })
      if (terminalReplayText) yield terminalReplayText
    }
  }
}
