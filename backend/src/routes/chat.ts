import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { getSessionUser, setSession } from '../session.js'
import {
  refreshGoogleAccessToken,
  reverseGeocode,
  youtubeFirstEmbed,
} from '../services/google.js'
import {
  saveMessage,
  getCostSummary,
  getBalance,
  getSpeechLang,
  setSpeechLangPref,
  saveNote,
  listNotes,
  deleteNote,
  getRecentHistory,
  getSharedMemory,
  getAnthropicKey,
} from '../db.js'
import { recallMemories, learnFromTurn } from '../services/agents.js'
import { generateImage } from '../services/image.js'
import { trackSpeechLang } from '../services/lang.js'
import { interpretDeviceCommand, deviceAck } from '../services/commands.js'
import { synthesize } from '../services/tts.js'
import { splitForSpeech } from '../services/speech-chunk.js'
import {
  browserOpen,
  crawlSite,
} from '../services/browser.js'
import { startTurn, appendTurn, finishTurn, readTurnFrom } from '../services/replayStore.js'
import {
  bridgeOnline,
  bridgeAskStream,
  BRIDGE_STALL,
  bridgeRepair,
  noteBrainActivity,
  resetBrainActivity,
  markFirstWord,
  finishBrainTurn,
  setOwnerTz,
  setProgress,
  setAnalysisDetail,
  getReadyDeploy,
  triggerDeploy,
  recentDevLog,
  stashAdminFiles,
  openRequirement,
  updateRequirement,
  resolveRequirement,
  ownedRequirement,
  type BridgeFile,
} from './bridge.js'
import { randomUUID } from 'node:crypto'

// Ultimul mesaj (normalizat) al adminului — pentru filtrul anti-ecou ASR:
// un duplicat sosit în <45s nu mai pornește o tură (zgomot de microfon).
let lastAdminEcho: { key: string; at: number } = { key: '', at: 0 }

// U+001F (unit separator) brackets a JSON control frame the frontend strips out
// of the text stream (never shown, never spoken), e.g.
// \x1f{"monitor":{"url":"...","title":"..."}}\x1f
const CTRL = String.fromCharCode(31)

// VOCEA CREIERULUI (Adrian, 4 iul): sinteza se face pe SERVER (Chirp 3 HD, limba
// userului), audio-ul se trimite prin punte ca UN CADRU {audio} și aplicația
// doar îl decodează + redă. Frontul NU sintetizează nimic (TTS de front = mort).
async function streamVoice(
  reply: { raw: { write(c: string): void } },
  text: string,
  lang: string | undefined,
): Promise<void> {
  // Ce se rostește: textul, curățat de etichete de unelte și de markdown.
  const spoken = text
    .replace(/\[[A-Z][^\]]*\]/g, '')
    .replace(/[*_#`~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Plafon de rostire ridicat 1800 → 4000 (Adrian, 10 iul: „ieșirea audio minim
    // 1 minut"). 4000 caractere ≈ 3-4 minute, sintetizate pe bucăți de frază, deci
    // un răspuns lung se aude întreg, nu tăiat.
    .slice(0, 4000)
  if (!spoken) return
  // Ordinul lui Adrian (6 iul): „nu vreau să mai aștept atâta până răspunzi".
  // Sinteza pe TOT textul deodată ținea vocea în așteptare cât dura tot
  // răspunsul; acum vorbește pe bucăți la graniță de frază — prima bucată
  // pleacă spre client imediat ce e gata, restul se sintetizează cât redă
  // clientul bucata anterioară (frontend le pune la coadă, vezi audioIO.ts).
  for (const chunk of splitForSpeech(spoken)) {
    try {
      const r = await synthesize(chunk, lang)
      if (r.ok) {
        reply.raw.write(`${CTRL}${JSON.stringify({ audio: r.audio.toString('base64') })}${CTRL}`)
      }
    } catch {
      /* o bucată pierdută nu oprește restul vocii */
    }
  }
}

// Human language names for the language lock — Claude obeys an explicit language
// name far more reliably than a bare locale code.
const LANG_NAMES: Record<string, string> = {
  ro: 'Romanian',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  de: 'German',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  uk: 'Ukrainian',
  tr: 'Turkish',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Coords {
  lat: number
  lon: number
}

// Anthropic rejects empty-content messages and non-alternating roles, and the
// first message must be a user turn. The client can produce all three: a
// monitor-only / tool-only reply leaves an empty assistant turn, and a local
// camera "ack" injects an assistant turn with no matching user turn (two
// assistants in a row, or a leading assistant). Any of these poisons the
// history and makes every later turn 400. Clean it here, centrally: drop empty
// turns, merge consecutive same-role turns, and drop leading assistant turns.
function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const content = (m.content ?? '').trim()
    if (!content) continue
    const prev = out.at(-1)
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n${content}`
    else out.push({ role: m.role, content })
  }
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // Resume a dropped reply from where it left off (mobile 3G/5G handoff). The
  // client passes the turn id it got as the first frame and how many characters
  // it already received; we replay the rest from the in-memory buffer. Unknown
  // or expired turn → empty 200, and the client falls back to a normal retry.
  app.get<{ Querystring: { turn?: string; from?: string } }>(
    '/api/chat/resume',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const turn = (req.query.turn ?? '').trim()
      const from = Number(req.query.from ?? 0) || 0
      if (!turn) return reply.code(400).send({ error: 'bad_request' })
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      try {
        for await (const chunk of readTurnFrom(turn, from)) reply.raw.write(chunk)
      } catch {
        /* buffer vanished mid-replay — just end cleanly */
      }
      reply.raw.end()
    },
  )

  // The signed-in user's own recent history — the chat panel loads it at
  // start, so a page refresh (now automatic on every release!) never shows an
  // empty chat again: everything said stays on screen.
  app.get('/api/chat/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const rows = await getRecentHistory(user.email, 60)
    return reply.send({ history: rows.map((r) => ({ role: r.role, content: r.content })) })
  })

  app.post<{
    Body: {
      messages?: ChatMessage[]
      image?: string
      // Poza a fost ATAȘATĂ EXPLICIT (Ctrl+V / încărcată), nu e cadrul ambient
      // al camerei — cerere de analiză fără condiție (vezi VISION_INTENT mai jos).
      imageIsAttachment?: boolean
      coords?: Coords
      screen?: { kind: string; title: string; active: boolean }[]
      now?: string
      tz?: string
      // Raw attachments for the ADMIN bridge: photos, archives, video — any
      // file rides the bridge to Claude (saved server-side by the worker).
      files?: { name?: string; type?: string; data?: string }[]
    }
  }>(
    '/api/chat',
    {
      // This is the ONE route allowed a big body (admin bridge photos/archives/
      // video). And it is the most cost-sensitive one, so it gets a tighter
      // rate limit than the global default — 40/min per IP is far more than a
      // human types, but stops an automated flood from burning API/subscription.
      bodyLimit: 100_000_000,
      config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    // ORDIN DIRECT (Adrian, 10 iul): „peste tot unde apare Claude se folosește
    // abonamentul mare; cheia API se scoate". Chatul NU mai depinde de
    // ANTHROPIC_API_KEY — și adminul și publicul răspund prin punte (abonament).
    // De aceea vechiul gard 503 „brain_not_configured" a dispărut de aici.
    const rawMessages = req.body?.messages
    const image = req.body?.image
    const imageIsAttachment = req.body?.imageIsAttachment === true
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'messages[] required' })
    }
    let messages = sanitizeHistory(rawMessages)
    // Cap the history sent to Claude. A long conversation (this user already has
    // hundreds of messages) would blow the token limit and make EVERY turn fail
    // with a "connection error" — especially when a big pasted page is added.
    // Long-term continuity comes from the memory agent, not the raw transcript.
    // Raised from 24 → 60: the models have a 1M-token context, and 24 was cutting
    // off important earlier context inside a single working session (the user
    // reported losing information mid-conversation). 60 keeps far more context
    // while staying well clear of any limit.
    const MAX_HISTORY = 60
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(-MAX_HISTORY)
      while (messages.length > 0 && messages[0].role !== 'user') messages.shift()
    }
    if (messages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'no usable messages' })
    }

    // The user's ESTABLISHED language (what they actually use), not their Google
    // account locale — used for the language lock AND the out-of-credit message.
    const storedPref = await getSpeechLang(user.email)

    // DEVICE COMMANDS + SPEECH LANGUAGE — both interpreted on the SERVER now
    // (moved out of the browser; owner's order: as much of the app as possible
    // on the server). A device command is answered below with a {device} frame
    // and no model call. A language switch is committed only after the SAME
    // new language on two consecutive messages (a one-off mis-detection never
    // flips the stored choice), persisted here, and announced to the client
    // with a {lang} frame so the recognizer + voice follow.
    const lastIncoming = messages.at(-1)
    const lastIncomingText = lastIncoming?.role === 'user' ? lastIncoming.content : ''
    const deviceCmd = interpretDeviceCommand(lastIncomingText, req.body?.screen)
    const committedLang = deviceCmd
      ? null // a device command is an order, not conversation — never shifts the language
      : trackSpeechLang(user.email, lastIncomingText, storedPref || user.locale)
    if (committedLang) await setSpeechLangPref(user.email, committedLang)
    const speechPref = committedLang ?? storedPref
    const userLang = speechPref || user.locale || 'unknown'
    const ro = userLang.toLowerCase().startsWith('ro')

    const userAnthropicKey = await getAnthropicKey(user.email)

    // Paywall: customers need prepaid credit; the owner (admin) is exempt, and
    // when Stripe isn't configured the app stays free/ungated. Clean binary stop
    // in the user's language + a paywall frame so the UI shows the top-up link.
    if (
      config.stripe.secretKey &&
      user.role !== 'admin' &&
      user.role !== 'demo' &&
      !userAnthropicKey &&
      (await getBalance(user.email)) <= 0
    ) {
      reply.hijack()
      reply.raw.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      reply.raw.write(
        ro
          ? 'Ai rămas fără credit. Te rog reîncarcă creditul ca să continuăm.'
          : "You've run out of credit. Please top up to keep talking with me.",
      )
      reply.raw.write(`${CTRL}${JSON.stringify({ paywall: true })}${CTRL}`)
      reply.raw.end()
      return
    }

    // A device command (camera / monitor tabs): answer instantly — {device}
    // control frame the client executes verbatim, plus a short ack — with NO
    // model call. Same stream shape as a normal turn ({turn} receipt first) so
    // the delivery check mark and the resume path still work.
    if (deviceCmd) {
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      const cmdTurnId = randomUUID()
      startTurn(cmdTurnId)
      const ack = deviceAck(deviceCmd, ro)
      const payload =
        `${CTRL}${JSON.stringify({ turn: cmdTurnId })}${CTRL}` +
        `${CTRL}${JSON.stringify({ device: deviceCmd })}${CTRL}` +
        ack
      appendTurn(cmdTurnId, payload)
      finishTurn(cmdTurnId)
      reply.raw.write(payload)
      if (lastIncomingText) void saveMessage(user.email, 'user', lastIncomingText)
      if (ack) void saveMessage(user.email, 'assistant', ack)
      reply.raw.end()
      return
    }

    // Sesiunea Google: dacă tokenul de acces a expirat (sau e pe cale), reîmprospătează-l
    // din refresh token și re-emite cookie-ul de sesiune — igienă de sesiune, ÎNAINTE de
    // hijack ca să putem încă seta headere/cookie.
    if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
      const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
      if (refreshed) {
        setSession(reply, {
          ...user,
          googleAccessToken: refreshed.accessToken,
          googleTokenExp: Date.now() + refreshed.expiresIn * 1000,
        })
      }
    }

    // Limba STABILITĂ a utilizatorului (nu locale-ul contului Google) — o folosește
    // calea punții pentru blocarea de limbă a creierului (langLock, mai jos).
    const langBase = userLang.toLowerCase().split('-')[0]
    const langName = LANG_NAMES[langBase]
    // GPS-ul live al dispozitivului — îl folosește calea punții pentru „lângă mine"/
    // vreme/hărți (lat/lon brut, fără lookup pe drumul critic al răspunsului).
    const coords = req.body?.coords
    // Aceeași oră peste tot: jurnalul/monitorul se ștampilează pe fusul lui Adrian
    // (trimis de client la fiecare tură), nu pe UTC-ul serverului.
    if (user.role === 'admin' && typeof req.body?.tz === 'string' && req.body.tz) setOwnerTz(req.body.tz)

    // MEMORIE (Adrian, 8 iul): recall = DB pur (fără model, fără credite) — ia faptele
    // recente + SCANEAZĂ după cuvintele întrebării în tot ce știe. O predăm creierului
    // de pe punte (singura cale acum) — de-aia Kelion „ține minte" de la o sesiune la alta.
    const lastMsg = messages.at(-1)
    const memRecall = await recallMemories(
      user.email,
      'kelion',
      lastMsg?.role === 'user' ? lastMsg.content : '',
    )

    const params: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    // Vision ONLY on demand: give Claude the camera frame solely when the user is
    // actually asking about what's visible. If we attached it every turn, Claude
    // would keep volunteering observations about what he sees — which the user
    // explicitly does NOT want. No frame attached = nothing to comment on.
    // Extended for BLIND users (their daily reality): describe surroundings,
    // what's ahead / in the way, obstacles, traffic lights, crossing safely,
    // reading signs and labels — all must summon Kelion's eyes instantly.
    const VISION_INTENT =
      /(\bsee\b|\blook\b|\bwatch\b|show me what|what('?s| is) this|what am i|what do you see|\bcamera\b|\bpicture\b|\bphoto\b|\bimage\b|colou?r|read this|\bscan\b|describe|in front of|ahead of me|obstacle|traffic light|cross(ing)? the (street|road)|\bsign\b|\blabel\b|\bdanger\b)|vezi|vede|uit[aăâ]|uite|prive[sșş]te|ce (e|este|am|[țt]in|ai[ -])|camer[aă]|imagin|poz[aă]|culoar|cite[sșş]te|scanea|descrie|[îi]n fa[țt][aă]|ce se afl[aă]|obstacol|pericol|semafor|trec(e|i)? strada|indicator|etichet[aă]|panou|u[șs][aă]|sc[aă]ri|trotuar|bordur[aă]/i
    if (image && params.length > 0) {
      const lastIdx = params.length - 1
      const lm = params[lastIdx]
      if (
        lm.role === 'user' &&
        typeof lm.content === 'string' &&
        (imageIsAttachment || VISION_INTENT.test(lm.content))
      ) {
        const data = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image
        params[lastIdx] = {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: lm.content },
          ],
        }
      }
    }

    // Stream Claude's reply back as plain UTF-8 text chunks.
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    })

    // Resumable stream: mirror EVERY byte we send into a short-lived buffer keyed
    // by this turn id, so if the mobile link drops mid-reply the client can
    // reconnect to /api/chat/resume and get the rest — no lost words, no
    // regeneration. Patching write/end here covers all downstream call sites
    // (brain text, control frames, tools, agents) without touching each one.
    const turnId = randomUUID()
    startTurn(turnId)
    const rawWrite = reply.raw.write.bind(reply.raw)
    const rawEnd = reply.raw.end.bind(reply.raw)
    // ÎNGHEȚUL DIN 10 IUL: cât gândește creierul (60–80s legitim), pe fir nu
    // pleca NICIUN octet — Cloudflare taie conexiunea tăcută (QUIC reset pe
    // /api/chat, 524 pe /resume după 100s), tura moare, iar aplicația așteaptă
    // la nesfârșit o tură moartă (chatul „ignoră"). Plasa: la fiecare 15s de
    // tăcere trimitem un cadru de control {ping} — ține conexiunea vie prin
    // Cloudflare și intră în bufferul de resume ca orice alt octet. Aplicația
    // îl ignoră (câmp necunoscut), dar ceasul ei de gardă îl vede ca semn de viață.
    let lastByteAt = Date.now()
    reply.raw.write = ((chunk: unknown, ...rest: unknown[]) => {
      lastByteAt = Date.now()
      if (typeof chunk === 'string') appendTurn(turnId, chunk)
      return (rawWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof reply.raw.write
    const pingTimer = setInterval(() => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return
      if (Date.now() - lastByteAt >= 15_000) reply.raw.write(`${CTRL}{"ping":1}${CTRL}`)
    }, 5_000)
    reply.raw.end = ((...args: unknown[]) => {
      clearInterval(pingTimer)
      finishTurn(turnId)
      return (rawEnd as (...a: unknown[]) => unknown)(...args)
    }) as typeof reply.raw.end
    // Client plecat (tab închis, net picat) fără end(): oprește pulsul oricum.
    reply.raw.on('close', () => clearInterval(pingTimer))
    // Announce the turn id FIRST so the client can resume from the very start.
    reply.raw.write(`${CTRL}${JSON.stringify({ turn: turnId })}${CTRL}`)
    // A language switch committed server-side this turn: tell the client so
    // the recognizer + local mirror follow (the pref is already persisted).
    if (committedLang) reply.raw.write(`${CTRL}${JSON.stringify({ lang: committedLang })}${CTRL}`)

    // Persist the user's new message (last turn).
    const lastTurn = messages.at(-1)
    const lastUserText = lastTurn?.role === 'user' ? lastTurn.content : ''
    // Demo = fără istoric (spec Adrian, 10 iul): mesajele vizitatorilor demo
    // nu se salvează nicăieri.
    if (lastTurn?.role === 'user' && user.role !== 'demo')
      void saveMessage(user.email, 'user', lastTurn.content)

    const isAdmin = user.role === 'admin'

    // ADMIN BRIDGE. Adrian's ABSOLUTE rule (4 iul): EVERY admin message is
    // answered by the Linux brain — NO exception, NO "kelion" bypass, NO
    // fallback to the paid API brain. Bridge down → Kelion says exactly that
    // and stops. (The old prefix shortcut leaked to the API brain when he
    // addressed Kelion by name — removed.)
    if (isAdmin) {
      // STOP pe cerință: dacă Adrian spune „stop / oprește / lasă / anulează" cât
      // o cerință e în lucru, o ÎNCHIDEM — supervizorul vede că nu mai e nimic de
      // dus la capăt (ownedReq = null) și nu mai re-asignează. Fără asta, bucla de
      // re-asignare (până la 3 încercări) ignora comanda. Revenim la modul chat.
      const stopCmd = /^\s*(stop|opre[șs]te(?:\-te)?|oprire|las[ăa](?:\s*asta)?|renun[țt][ăa]|anuleaz[ăa]|nu mai lucra|gata cu asta)[\s.!]*$/i
      if (stopCmd.test(lastUserText) && ownedRequirement()) {
        resolveRequirement()
        const msg = 'Am oprit — cerința e închisă, nu mai reîncerc. Sunt pe modul chat, spune-mi ce vrei.'
        reply.raw.write(msg)
        reply.raw.end()
        void saveMessage(user.email, 'assistant', msg)
        return
      }
      // OK → DEPLOY: PRIMUL, înaintea oricărui filtru (bug 5 iul: filtrul de
      // ecou înghițea al doilea „da" din 45s → publicarea nu pornea și
      // aplicația părea moartă). Un „da" e ORDIN, niciodată zgomot.
      const affirm = /^\s*(ok(ay)?|da|d[aă]\-?i drumul|public[aă]|public|deploy|hai|bun|merge|gata)[\s.!]*$/i
      if (getReadyDeploy() && affirm.test(lastUserText)) {
        const t = triggerDeploy()
        const msg = t
          ? 'Am zis să se publice — serverul dă drumul acum. Îți spun când e live.'
          : 'Nu mai am nimic pregătit de publicat acum.'
        reply.raw.write(msg)
        reply.raw.end()
        void saveMessage(user.email, 'assistant', msg)
        return
      }
      // ── FILTRU ANTI-ZGOMOT ASR (Adrian, 5 iul) ────────────────────────────
      // Microfonul permanent trimite uneori ACEEAȘI frază de mai multe ori
      // („Nu." ×7) sau fragmente dublate în același mesaj. Fiecare duplicat
      // pornea o tură plină → creierul umplea chatul („Sunt aici") și zgomotul
      // suprascria „Cererea în analiză". Regula: propozițiile identice
      // consecutive se strâng într-una; un mesaj identic cu precedentul, sosit
      // în <45s, nu pornește o tură — dar primește un rând scurt, NICIODATĂ
      // tăcere totală (tăcerea arăta ca o aplicație moartă — bug 5 iul).
      const normNoise = (s: string): string =>
        s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      const cleanUserText = lastUserText
        .split(/(?<=[.!?])\s+/)
        .filter((s, i, arr) => i === 0 || normNoise(s) !== normNoise(arr[i - 1]))
        .join(' ')
        .trim()
      const noiseKey = normNoise(cleanUserText)
      if (noiseKey && noiseKey === lastAdminEcho.key && Date.now() - lastAdminEcho.at < 45_000) {
        // AICI SE RUPEA ȘI FILTRUL (mesaje scrise „nu ajung", 4 iul): ceasul se
        // reîmprospăta la FIECARE duplicat, deci Adrian care retrimitea același
        // text (fiindcă nu primea răspuns) era înghițit la nesfârșit ca „ecou".
        // Fereastra curge acum de la PRIMA apariție: a doua retrimitere după
        // 45s pornește o tură reală. (Ecoul de microfon vine oricum în <45s.)
        const echoMsg = 'Am auzit (același mesaj, probabil ecou) — lucrez în continuare; dacă e comandă nouă, mai adaugă un cuvânt.'
        reply.raw.write(echoMsg)
        reply.raw.end()
        void saveMessage(user.email, 'assistant', echoMsg)
        return
      }
      lastAdminEcho = { key: noiseKey, at: Date.now() }
      // BARGRAF LA INTRAREA ÎN CREIER (Adrian, 10 iul): serverul confirmă EXACT
      // textul pe care îl predă creierului la această tură — banda din UI îl
      // afișează. Nu e ecou local: dacă banda nu se schimbă când vorbești,
      // vocea a murit ÎNAINTE de creier.
      reply.raw.write(`${CTRL}${JSON.stringify({ heard: (cleanUserText || lastUserText).slice(0, 500) })}${CTRL}`)
      let a = ''
      // MONITOR GOL LA FIECARE COMANDĂ (Adrian, 4 iul): wipe the live execution
      // feed so this command starts clean and shows ONLY its own flow. History
      // is kept (Jurnal Claude) and the telemetry bars keep running.
      resetBrainActivity()
      if (bridgeOnline()) {
        // The conversation comes from the DATABASE, not from the page: the
        // visible chat can be empty (clean login, refresh, another device) but
        // the saved history never is — so the bridge brain ALWAYS knows what
        // was discussed, including "what did I ask 5 minutes ago". The current
        // turn's text is appended in case it isn't persisted yet.
        // 15 messages (was 30): half the prompt weight → visibly faster replies.
        const dbRows = await getRecentHistory(config.adminEmail, 15)
        const past = dbRows.map(
          (m) => `${m.role === 'user' ? 'Adrian' : 'Kelion'}: ${m.content.slice(0, 1500)}`,
        )
        const lastLine = `Adrian: ${lastUserText}`
        if (past.length === 0 || !past[past.length - 1].includes(lastUserText.slice(0, 200))) {
          past.push(lastLine)
        }
        const convo = past.join('\n')
        // ── ONE context packet: everything vital reaches the Linux brain in a
        // single block — his LIVE GPS (lat/lon + city), his local time, and the
        // ready-made weather URL. No more guessing, no more Google→CAPTCHA.
        const bc = req.body?.coords
        let ctxBlock = ''
        if (bc && Number.isFinite(bc.lat) && Number.isFinite(bc.lon)) {
          const place = await reverseGeocode(bc.lat, bc.lon).catch(() => '')
          const windy = `https://embed.windy.com/embed2.html?lat=${bc.lat.toFixed(4)}&lon=${bc.lon.toFixed(4)}&zoom=9&type=map&location=coordinates&metricTemp=%C2%B0C`
          ctxBlock +=
            `LOCUL LUI ADRIAN ACUM (GPS live din aplicație): lat ${bc.lat.toFixed(5)}, lon ${bc.lon.toFixed(5)}` +
            (place ? ` — aproximativ ${place}` : '') +
            `. Când zice „aici", „la mine", „vremea afară" fără să numească un loc, ĂSTA e locul.\n` +
            `PENTRU VREME: pune pe monitor EXACT [SHOW ${windy} | Vremea la tine] — sursă reală, se afișează pe loc. NU căuta NICIODATĂ vremea pe Google (te blochează ca robot).\n`
        }
        const nowB = typeof req.body?.now === 'string' ? req.body.now : ''
        const tzB = typeof req.body?.tz === 'string' && req.body.tz ? req.body.tz : ''
        if (nowB && !Number.isNaN(Date.parse(nowB))) {
          try {
            ctxBlock += `ORA LOCALĂ A LUI ADRIAN: ${new Date(nowB).toLocaleString('ro-RO', { timeZone: tzB || 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}${tzB ? ` (${tzB})` : ''}.\n`
          } catch {
            /* fus invalid — sar peste */
          }
        }
        if (ctxBlock) ctxBlock = `CONTEXTUL TĂU LIVE:\n${ctxBlock}\n`
        // Explicit language lock so the bridge answer is ALWAYS in the admin's
        // established language (the bridge bypasses the normal brain's guardian).
        const langLock = langName
          ? `RĂSPUNDE EXCLUSIV în ${langName} — fiecare cuvânt în ${langName}, indiferent de limba în care e scris acest context.\n\n`
          : ''
        // The Claude answering in chat gets the LIVE work journal, so he knows
        // exactly what laptop-Claude built today and what's in progress — no
        // more "the chat doesn't know what's happening here".
        const journal = recentDevLog(15)
        const journalBlock =
          journal.length > 0
            ? `JURNALUL LUCRULUI DE AZI (Claude pe laptop, live):\n${journal.join('\n')}\n\n`
            : ''
        // SHARED MEMORY ("caietul comun"): everything either Claude wrote — the
        // laptop builder and this server brain read the SAME notebook, so what
        // was learned/done in one place is known in the other.
        const shared = await getSharedMemory(30)
        const sharedBlock =
          shared.length > 0
            ? 'MEMORIA COMUNĂ (caietul pe care-l împărțiți tu și Claude-constructorul de pe laptop):\n' +
              shared.map((m) => `- [${m.source || '?'}] ${m.content}`).join('\n') +
              '\n\n'
            : ''
        // THE DECISION SYSTEM: the bridge brain is Adrian's ONLY interlocutor
        // (his explicit order, 4 iul) — there is no hand-off to any other AI.
        const decision =
          'EȘTI CREIERUL INTELIGENT al lui Adrian — gândești, analizezi, decizi și ACȚIONEZI singur. NU ești dispecer și NU clasifici mesaje ca să le predai altcuiva. Ai acces total la server și la cod (unelte reale): inspectezi starea adevărată (rulezi comanda, nu ghici), repari, construiești, verifici — TU.\n' +
          'MODURI DE LUCRU (comută SINGUR, automat, după ce cere Adrian): (1) CHAT — doar conversație/întrebare: răspunde scurt și direct, NU deschide nicio cerință de execuție. (2) LUCRU — o cerință de execuție (repară/construiește/modifică): apucă-te, du-o la capăt, ține-o pe o singură cerință; NU redeschide și NU relua la infinit aceeași sarcină. (3) RAPORT — după ce ai terminat: raportează rezultatul cu dovada reală, apoi ÎNCHIDE (revii la CHAT). Dacă Adrian spune „stop/oprește/lasă/anulează", OPREȘTE lucrul pe loc și treci în CHAT — nu insista.\n' +
          'La fiecare mesaj: înțelege ce vrea Adrian, GÂNDEȘTE și FĂ. Dacă e o întrebare → răspunde din ce VEZI real în cod/sistem, nu din presupuneri. Dacă e ceva de analizat/reparat/construit → apucă-te cu uneltele tale, dus până la capăt, și raportează ce ai făcut cu dovada reală (ieșirea comenzii). Un job mare, de durată, îl POȚI da constructorului tău cu [EXECUT] dacă tu, ca inginer-șef, decizi așa — dar e alegerea ta, nu o regulă; nu preda ce poți face singur.\n' +
          'TON OBLIGATORIU (Adrian, 5 iul): profesional, precis, inteligență superioară — ca un inginer-șef. INTERZISE: umplutura emoțională („sunt aici", „respiră", „nu plec nicăieri", „stau lângă tine"), consolările, repetițiile. Scurt și la obiect, fiecare propoziție cu conținut. Fragmentele scurte repetate („Nu.", „Nu știu.") sunt aproape sigur zgomot de microfon: NU le răspunde cu umplutură — o singură replică minimă, tehnică, sau întreabă o dată ce a vrut să spună.\n\n' +
          'UNELTELE TALE (le comanzi direct, serverul le execută și taie eticheta din text):\n' +
          '- Afișezi ceva pe monitorul lui: [SHOW https://adresa | titlu scurt]. Pentru hartă https://embed.waze.com/iframe?zoom=12&lat=LAT&lon=LON, pentru alte site-uri adresa normală (se deschide în browserul live).\n' +
          '- Pui un clip pe YouTube: [YT ce vrei să pornească] (ex: [YT Coldplay Yellow live]). NU inventa NICIODATĂ un link/ID de YouTube — scrie doar ce vrei, serverul găsește clipul real și îl pornește pe monitor.\n' +
          '- Generezi o imagine pe monitor: [IMG descriere detaliată în engleză].\n' +
          '- Salvezi o notiță pentru Adrian: [NOTE textul notiței].\n' +
          '- Îi arăți notițele salvate: [NOTES] (le citește serverul, cu numărul lor). Ștergi una: [DELNOTE număr] (ex: [DELNOTE 12]).\n' +
          '- Îi spui cheltuielile reale: [COST] (serverul citește suma exactă din bază).\n' +
          '- Arăți o HARTĂ pe monitor: [MAP numele locului/adresei] (ex: [MAP Londra] sau [MAP Piața Unirii Cluj]).\n' +
          '- Parcurgi un site pagină cu pagină și-l treci în revistă pe monitor: [CRAWL https://adresa] (ex: [CRAWL https://exemplu.ro]).\n' +
          '- Afișezi TEXT pe monitor (un răspuns, o listă, un plan, un rezumat — orice nu e o pagină web): [DOC titlu scurt] pe prima linie; TOT ce scrii după aceea apare automat și pe monitorul lui ca document. Când Adrian zice „afișează pe monitor" / „pune pe ecran" / „arată-mi pe monitor" și nu cere o pagină web, folosește [DOC] — nu spune că nu poți.\n' +
          '- Cureți ecranul/monitorul: [CLEAR].\n' +
          'ECHIPA TA de 7 agenți specialiști (rulează pe server, pe abonament). Deleagă un task greu/de domeniu cu [AGENT nume: sarcina completă], apoi spune scurt „întreb <agentul>":\n' +
          '  • researcher — căutare web, fapte reale, cifre, actualități\n' +
          '  • scribe — scris, redactare, rezumat, traducere\n' +
          '  • navigator — locuri, rute, distanțe, trafic\n' +
          '  • studio — concepte vizuale, logo-uri (imaginea reală o pui tu cu [IMG])\n' +
          '  • developer — scrie software și îl rulează\n' +
          '  • tester — testează cod și dă verdict PASS/FAIL\n' +
          '  • secretary — redactează emailuri/mesaje (accesul la Gmail-ul real cere contul conectat)\n' +
          'Când Adrian cere ceva din aceste domenii (mai ales căutare/informații actuale, scris serios, cod), FOLOSEȘTE [AGENT …] — nu inventa răspunsul.\n' +
          'REGULĂ DE FORMĂ (streaming): TOATE etichetele ([EXECUT],[SHOW],[YT],[IMG],[NOTE],[NOTES],[DELNOTE],[COST],[MAP],[DOC],[CLEAR],[AGENT …]) stau pe PRIMA LINIE; de la a doua linie textul vorbit — scurt, fără markdown. NU inventa și NU pretinde că ai făcut ceva fără etichetă.\n\n'
        // ANY attachment rides the bridge to Claude: photos, texts, archives,
        // video (voice arrives already transcribed as text). Base64 payloads —
        // the budget is the WHOLE pipe: just under the Cloudflare 100MB cap.
        const files: BridgeFile[] = []
        let budget = 95_000_000 // ~70MB decoded — maximul fizic al țevii
        const addFile = (name: string, type: string, raw: string): void => {
          const data = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
          if (!data || data.length > budget) return
          budget -= data.length
          files.push({ name: name.slice(0, 120), type: type.slice(0, 80), data })
        }
        for (const f of req.body?.files ?? []) {
          if (typeof f?.data === 'string') {
            addFile(f.name || 'fisier', f.type || 'application/octet-stream', f.data)
          }
        }
        if (image && files.length === 0) addFile('captura.jpg', 'image/jpeg', image)
        // TOTAL ACCESS: everything the admin drops in chat (photos, pasted
        // screenshots, archives, video) is stashed for laptop-Claude too, so
        // the builder sees exactly what the voice saw.
        if (files.length > 0) stashAdminFiles(files)
        // ── STREAMING (viteza sunetului): chunks flow straight to the client;
        // Kelion writes AND speaks from the first sentence (~2s), while the
        // Linux decision engine may auto-escalate hard questions to Fable.
        // TOOL TAGS live on the FIRST LINE of the reply (the brain is told so):
        // once the first newline arrives, tags are executed and the rest of the
        // stream is released verbatim.
        const bridgeBase = `https://${req.headers.host ?? 'kelionai.app'}`
        let streamed = ''
        let head = ''
        let headDone = false
        // [DOC titlu] pe prima linie = „afișează pe monitor": la finalul
        // stream-ului, întregul text rostit e trimis și ca document pe monitor.
        let docTitle: string | null = null
        let execOrderId: string | undefined
        const pendingTags: Promise<void>[] = []
        const emit = (t: string): void => {
          if (!t) return
          reply.raw.write(t)
          streamed += t
        }
        // ── LEGEA 200 (Adrian, 5 iul): ORICE operațiune se certifică — succes
        // real („200") sau pleacă AUTOMAT la reparat. Fără eșec tăcut, fără
        // .catch gol care înghite defectul.
        const certify = (op: string, fn: () => Promise<true | string>): void => {
          pendingTags.push(
            (async () => {
              let verdict: true | string
              try {
                verdict = await fn()
              } catch (e) {
                verdict = e instanceof Error ? e.message.slice(0, 140) : 'excepție'
              }
              if (verdict === true) {
                noteBrainActivity(`🟢 200 — ${op}`)
              } else {
                noteBrainActivity(`🔴 fără 200 — ${op} → trimis automat la reparat`)
                bridgeRepair(
                  `LEGEA 200 (auto): operațiunea „${op}" a eșuat: ${verdict}. Găsește cauza reală și repar-o.`,
                  { autonomous: true },
                )
              }
            })(),
          )
        }
        // SARCINA REALĂ, nu „da" (Adrian, 5 iul — bug de dispecerizare): când
        // Adrian aprobă cu „da"/„ok", `lastUserText` e doar aprobarea, nu munca.
        // Trimițând „da" la constructor, ăsta nu știe ce să facă (a plecat pe
        // timezone aiurea). Regula: dacă mesajul e o simplă afirmație, dispecerul
        // trimite CONTEXTUL (ultimele replici = propunerea creierului + „da"-ul),
        // ca să înțeleagă ce s-a cerut de fapt.
        const bareAffirm = /^\s*(ok(ay)?|da|d[aă]|hai|bun|gata|merge|f[aă]|fa|continu[aă]|continua|preia|trimite|public[aă]?)[\s.!]*$/i
        // „Reia"/„termină"-style (5 iul, ordinul „reia terminat cu această
        // comandă."): un mesaj scurt făcut DOAR din verbe de reluare + umplutură
        // referă sarcina anterioară, nu descrie una nouă. Trimis verbatim,
        // constructorul primește un fragment gol și nu are ce executa — deci și
        // el primește CONTEXTUL, ca la „da". „Termină implementarea X" NU intră
        // aici (are conținut propriu) — doar fragmentele fără substanță.
        const resumeVerb = /^(reia|relu[aă]m|termin[aă]|terminat[aă]?|finalizeaz[aă]|încheie|incheie|(re)?încearc[aă]|(re)?incearc[aă])$/i
        const resumeFiller =
          /^(din|nou|cu|aceast[aă]|asta|acest|comanda|comand[aă]|sarcina|sarcin[aă]|ordinul|treaba|lucrarea|te|rog|acum|iar|tot|o|ce|ai|unde|r[aă]mas|de|la|cap[aă]t|ultima|imediat|[șs]i)$/i
        const resumeRef = (t: string): boolean => {
          const words = t.split(/[\s.,!?"„”–-]+/).filter(Boolean)
          if (words.length === 0 || !resumeVerb.test(words[0])) return false
          return words.every((w) => resumeVerb.test(w) || resumeFiller.test(w))
        }
        const refersToContext = bareAffirm.test(lastUserText.trim()) || resumeRef(lastUserText.trim())
        const dispatchTask = refersToContext
          ? `SARCINA (mesajul lui Adrian „${lastUserText.trim()}" doar aprobă sau cere reluarea; ce a cerut de fapt e în conversația de mai jos — fă exact ce reiese din ea, nu răspunde la fragment):\n${past.slice(-8).join('\n')}`
          : lastUserText
        const runTags = (line: string): string => {
          if (/\[EXECUT\]/i.test(line)) execOrderId = bridgeRepair(dispatchTask) ?? undefined
          const showTag = /\[SHOW\s+(\S+?)(?:\s*\|\s*([^\]]*))?\]/i.exec(line)
          const imgTag = /\[IMG\s+([^\]]+)\]/i.exec(line)
          const noteTag = /\[NOTE\s+([^\]]+)\]/i.exec(line)
          const mapTag = /\[MAP\s+([^\]]+)\]/i.exec(line)
          const crawlTag = /\[CRAWL\s+(\S+)\]/i.exec(line)
          if (noteTag) {
            noteBrainActivity(`Salvez notița: ${noteTag[1].trim().slice(0, 80)}`)
            certify('salvez notița', async () => {
              await saveNote(user.email, noteTag[1].trim())
              return true
            })
          }
          // [CRAWL url] (cererea #24): parcurge un site pagină cu pagină și pune
          // rezumatul fiecărei pagini pe monitor, ca document citibil.
          if (crawlTag) {
            const site = crawlTag[1].trim()
            noteBrainActivity(`Parcurg site-ul: ${site}`)
            certify(`parcurg ${site}`, async () => {
              const r = await crawlSite(user.email, bridgeBase, site, 8)
              if (r.error || r.pages.length === 0) {
                emit(`\nN-am putut parcurge ${site} (${r.error || 'fără pagini'}).`)
                return r.error || 'fără pagini'
              }
              const doc = r.pages
                .map((p, i) => `${i + 1}. ${p.title || p.url}\n   ${p.url}\n   ${p.text.slice(0, 400)}`)
                .join('\n\n')
              reply.raw.write(
                `${CTRL}${JSON.stringify({ doc: { title: `Site parcurs: ${site} (${r.pages.length} pagini)`, text: doc } })}${CTRL}`,
              )
              return true
            })
          }
          if (mapTag) {
            const place = mapTag[1].trim()
            noteBrainActivity(`Afișez harta: ${place}`)
            certify(`afișez harta ${place}`, async () => {
              let url = config.googleMapsKey
                ? `https://www.google.com/maps/embed/v1/place?key=${config.googleMapsKey}&q=${encodeURIComponent(place)}`
                : ''
              if (!url) {
                // No Maps key: geocode the place name → coords (free Nominatim),
                // then show a Waze live map (embeddable, no key needed).
                try {
                  const g = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`,
                    { headers: { 'User-Agent': 'Kelionai/1.0 (contact@kelionai.app)' }, signal: AbortSignal.timeout(8000) },
                  )
                  const arr = (await g.json()) as { lat?: string; lon?: string }[]
                  const lat = arr[0]?.lat
                  const lon = arr[0]?.lon
                  url = lat && lon
                    ? `https://embed.waze.com/iframe?zoom=12&lat=${lat}&lon=${lon}`
                    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
                } catch {
                  url = `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
                }
              }
              reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title: place } })}${CTRL}`)
              return true
            })
          }
          // [YT query] — the brain never guesses a video ID (it hallucinates and
          // the embed fails). It names what to play; the server resolves a REAL,
          // currently-available video (Serper → Gemini) and shows the embed.
          const ytTag = /\[YT\s+([^\]]+)\]/i.exec(line)
          if (ytTag) {
            const q = ytTag[1].trim()
            noteBrainActivity(`Caut pe YouTube: ${q}`)
            certify(`pornesc clip YouTube: ${q.slice(0, 50)}`, async () => {
              const v = await youtubeFirstEmbed(q)
              if (v) {
                reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: v.embed, title: v.title || q } })}${CTRL}`)
                return true
              }
              emit(`\nN-am găsit un clip care să pornească pentru „${q}".`)
              return 'niciun clip găsit/pornit'
            })
          }
          // [COST] — real spend, read from the cost_events table (not invented).
          if (/\[COST\]/i.test(line)) {
            noteBrainActivity('Adun cheltuielile')
            certify('citesc cheltuielile reale', async () => {
              const c = await getCostSummary()
              const kinds = Object.entries(c.byKind)
                .map(([k, v]) => `${k} $${v.toFixed(2)}`)
                .join(', ')
              emit(
                `\nCheltuieli: total $${c.total.toFixed(2)}, azi $${c.today.toFixed(2)}${kinds ? ` (${kinds})` : ''}.`,
              )
              return true
            })
          }
          // [NOTES] — read back the saved notes (real rows, with their ids so he
          // can delete by number).
          if (/\[NOTES\]/i.test(line)) {
            noteBrainActivity('Îți citesc notițele')
            certify('citesc notițele', async () => {
              const notes = await listNotes(user.email, 20)
              if (notes.length === 0) {
                emit('\nNu ai nicio notiță salvată.')
                return true
              }
              const list = notes
                .map((n) => `#${n.id} ${n.title ? n.title + ': ' : ''}${n.content.slice(0, 90)}`)
                .join('\n')
              emit(`\nNotițele tale:\n${list}`)
              return true
            })
          }
          // [DELNOTE id] — delete one of his own notes by id.
          const delTag = /\[DELNOTE\s+(\d+)\]/i.exec(line)
          if (delTag) {
            const id = Number(delTag[1])
            noteBrainActivity(`Șterg notița #${id}`)
            certify(`șterg notița #${id}`, async () => {
              const ok = await deleteNote(user.email, id)
              emit(ok ? `\nAm șters notița #${id}.` : `\nN-am găsit notița #${id} la tine.`)
              return true // notiță inexistentă = răspuns corect, nu defect de reparat
            })
          }
          if (/\[CLEAR\]/i.test(line)) {
            reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url: '', title: '' } })}${CTRL}`)
            noteBrainActivity('Am curățat monitorul')
          }
          // [DOC titlu] — textul răspunsului (de la a doua linie) merge și pe
          // monitor ca document; cadrul se trimite la final, cu textul complet.
          const docTag = /\[DOC(?:\s+([^\]]*))?\]/i.exec(line)
          if (docTag) {
            docTitle = (docTag[1] ?? '').trim()
            noteBrainActivity(`Afișez pe monitor: ${docTitle || 'răspunsul'}`)
          }
          if (showTag) {
            const url = showTag[1]
            const title = (showTag[2] ?? '').trim()
            noteBrainActivity(`Afișez pe monitor: ${title || url}`)
            certify(`afișez pe monitor: ${(title || url).slice(0, 50)}`, async () => {
              if (iframeSafe(url)) {
                reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
                return true
              }
              const live = await browserOpen(user.email, bridgeBase, url)
              if ('error' in live) {
                // Cădere pe iframe direct — poate randa totuși; e drum proiectat,
                // dar fără browser live NU e 200 → pleacă și la reparat.
                reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
                return `browserul live a eșuat (${live.error}); am căzut pe iframe direct`
              }
              browserToolResult(reply, live)
              return true
            })
          }
          if (imgTag) {
            noteBrainActivity(`Generez o imagine: ${imgTag[1].trim().slice(0, 70)}`)
            certify('generez imaginea', async () => {
              const result = await generateImage(imgTag[1].trim())
              if ('error' in result) return `generatorul a răspuns: ${JSON.stringify(result)}`.slice(0, 140)
              const url = `${bridgeBase}/api/image/${result.id}`
              reply.raw.write(
                `${CTRL}${JSON.stringify({ monitor: { url, title: imgTag[1].slice(0, 60) }, image: { url } })}${CTRL}`,
              )
              return true
            })
          }
          return line
            .replace(/\[EXECUT\]/gi, '')
            .replace(/\[SKILL\]/gi, '')
            .replace(/\[SHOW[^\]]*\]/gi, '')
            .replace(/\[IMG[^\]]*\]/gi, '')
            .replace(/\[NOTE[^\]]*\]/gi, '')
            .replace(/\[MAP[^\]]*\]/gi, '')
            .replace(/\[CRAWL[^\]]*\]/gi, '')
            .replace(/\[DOC[^\]]*\]/gi, '')
            .replace(/\[YT[^\]]*\]/gi, '')
            .replace(/\[COST\]/gi, '')
            .replace(/\[NOTES\]/gi, '')
            .replace(/\[DELNOTE[^\]]*\]/gi, '')
            .replace(/\[CLEAR\]/gi, '')
            .replace(/\[AGENT[^\]]*\]/gi, '') // agent tag: executed on Linux (subscription)
            .replace(/[ \t]{2,}/g, ' ')
            .trim()
        }
        const deliver = (text: string): void => {
          headDone = true
          const nl = text.indexOf('\n')
          const first = nl === -1 ? text : text.slice(0, nl)
          const rest = nl === -1 ? '' : text.slice(nl + 1).trim()
          const spoken = runTags(first)
          emit(spoken && rest ? `${spoken}\n${rest}` : spoken || rest)
        }
        const releaseHead = (force: boolean): void => {
          if (headDone) return
          const s = head.trimStart()
          // Tool tags ALWAYS start with '[' on the first line. If the reply
          // doesn't start with '[', there are NO tags → stream from the very
          // first character (the common case, ~2s to first word). Only a
          // tag-carrying reply waits for the first newline (line 1 = tags).
          if (s && !s.startsWith('[')) {
            deliver(head)
            head = ''
            return
          }
          const nl = head.indexOf('\n')
          if (nl !== -1 || head.length > 400 || force) {
            deliver(head)
            head = ''
          }
        }
        // Monitor shows the brain is on it the instant Adrian sends (his rule:
        // never the raw message text — just that the brain is answering).
        noteBrainActivity('Creierul de pe Linux răspunde la mesajul tău…')
        setProgress(30, 'Creierul analizează')
        // Detaliul din spatele barei: pe monitor rămâne doar statusul, dar la
        // CLICK pe „Creierul analizează" Adrian vede exact CE cerere e în lucru.
        // GARDĂ (Adrian, 5 iul): fragmentele scurte („Nu.", „da", „ok") NU
        // suprascriu cererea reală aflată în analiză — zgomotul de microfon
        // făcea detaliul să arate „Nu." în loc de cererea adevărată.
        if (normNoise(cleanUserText).split(' ').filter(Boolean).length >= 3)
          setAnalysisDetail(cleanUserText)
        let firstWord = false
        // NICIO CERERE FĂRĂ RĂSPUNS (Adrian, 4 iul): if 30s pass with TOTAL
        // silence, re-analyze — a fresh job hits a fresh worker poll (or the
        // watchdog-restarted worker), up to 4 times. A request is never left to
        // rot for 4 minutes and never ends without a clear answer. Once a single
        // word has streamed we stop retrying (a slow-but-flowing reply is fine).
        let answer: string | null = null
        const onChunk = (chunk: string): void => {
          // '' = puls de viață (creierul gândește) — armează doar ceasurile de
          // stall în bridgeAskStream; nu e text de difuzat.
          if (!chunk) return
          if (!firstWord) {
            firstWord = true
            markFirstWord() // primul cuvânt real → măsurăm viteza creierului
            setProgress(65, 'Compun răspunsul')
          }
          if (headDone) emit(chunk)
          else {
            head += chunk
            releaseHead(false)
          }
        }
        // MEMORIE PE PUNTE (Adrian, 8 iul — regula lui): dacă răspunsul nu e în
        // memoria scurtă, Kelion caută în tot ce știe; găsit → răspunde direct;
        // negăsit → întreabă-l și ține minte. `memRecall` (DB pur) poartă exact
        // asta; îl dăm și la începutul sesiunii, și în fiecare tură (mai jos).
        const memBlock = memRecall.trim()
          ? `\nMEMORIE DESPRE ADRIAN (ce știi deja despre el — când te întreabă ceva de aici, RĂSPUNDE DIRECT cu faptul; dacă NU găsești nicăieri, întreabă-l și ține minte răspunsul):\n${memRecall.trim().slice(0, 2500)}\n`
          : ''
        const bridgePrompt = decision + ctxBlock + sharedBlock + memBlock + langLock + journalBlock + convo
        // PACHET TURĂ SUBȚIRE (Adrian, 10 iul: „chat live gândit; dacă e nevoie
        // de ceva, DOAR atunci se caută în istoric"). Sesiunea caldă din worker e
        // DEJA amorsată cu TOT contextul (bridgePrompt) la începutul sesiunii, deci
        // per tură trimitem DOAR mesajul nou + blocarea de limbă + (dacă scanarea
        // a găsit ceva relevant) memoria — adică fix „căutarea la nevoie" în
        // istoric. Contextul/jurnalul/caietul NU se mai reîncarcă la fiecare tură:
        // exact asta ținea primul cuvânt în așteptare. Așa tura caldă e minusculă
        // → primul cuvânt sub 1s. (memBlock = scanare DB pură, fără cost de model.)
        const turnPacket =
          (memBlock ? `${memBlock}\n` : '') +
          `${langLock}\nMESAJ NOU de la Adrian: ${cleanUserText || lastUserText}`
        // O SINGURĂ tură, ZERO reîncercări (Adrian, 10 iul: „dacă la tura 1 nu
        // întoarce răspuns, nu pleacă încă o tură — revine în chat, pentru
        // clarificări"). Dacă prima tură tace, NU relansăm nimic; mai jos Kelion
        // se întoarce în chat și cere lămuriri. Fereastra primului cuvânt e
        // generoasă (75s) tocmai ca să nu tăiem un raționament care chiar lucrează.
        const maxTries = 1
        for (let attempt = 1; attempt <= maxTries; attempt++) {
          // Fereastra primului cuvânt = 75s, nu 30s (Adrian, 9 iul: „legătura
          // ruptă" pe mesajul curent). Calea de RAȚIONAMENT AVANSAT durează
          // legitim 60–80s fără să scoată vreun cuvânt; la 30s serverul declara
          // fals „punte înțepenită", spunea „mi s-a rupt legătura" și reanaliza —
          // deși creierul CHIAR răspundea (revenea la ~48s). Pulsul de viață tot
          // resetează ceasul cât timp workerul îl trimite; 75s e doar plasa când
          // nu-l trimite (ex. worker care nu pulsează în timpul gândirii).
          answer = await bridgeAskStream(bridgePrompt, files, onChunk, 240_000, 75_000, turnPacket)
          if (answer === BRIDGE_STALL && !headDone && !streamed.trim()) {
            head = ''
            if (attempt < maxTries) {
              noteBrainActivity('⏳ Creierul încă gândește — mai aștept o dată, în liniște')
              continue
            }
          }
          break
        }
        if (answer === BRIDGE_STALL) answer = null
        // Finalisation: a non-streaming worker (or a short reply that never hit
        // a newline) lands here with everything still buffered.
        if (!headDone) {
          const whole = (answer && answer.trim()) || head
          if (whole.trim()) {
            // GARDĂ (Adrian, 9 iul): un worker care a renunțat trimite fals „mi s-a
            // rupt legătura cu creierul… mai trimite-l o dată". NU i-l mai arătăm —
            // îl tratăm ca stall: `answer` devine gol, deci calea de mai jos
            // re-cozează cererea și răspunde EL, fără să-i ceară retrimiterea.
            const norm = whole.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            if (/rupt.{0,15}legatura|mai trimite|trimite-l.{0,20}o data/.test(norm)) {
              answer = null
              head = ''
            } else {
              deliver(whole)
            }
          }
        }
        // Drain side-effect tags FIRST — [COST]/[NOTES]/[DELNOTE]/[YT] emit their
        // real (spoken) result here, so capture `a` AFTER they've run or the
        // saved reply would miss the numbers/list.
        await Promise.all(pendingTags)
        a = streamed.trim()
        // [DOC] cerut pe prima linie → „afișează pe monitor": răspunsul complet
        // apare și pe monitor ca document (frontend: openWorkspaceDoc), nu doar
        // în chat. Ordinul lui Adrian (4 iul): „afișează pe monitor".
        if (docTitle !== null && a) {
          reply.raw.write(
            `${CTRL}${JSON.stringify({ doc: { title: docTitle || 'Pe monitor', text: a.slice(0, 9000) } })}${CTRL}`,
          )
        }
        if (/\[EXECUT\]/i.test(answer ?? '')) {
          // Handed to the builder — the process bar continues from the builder
          // (agent → files → build → deploy → live), so don't jump to 100 here.
          setProgress(15, 'Trimis la constructor')
          // CHAT CU CERINȚĂ DE LUCRU: stampilăm timpii dispatch-ului (tip „lucru")
          // — Adrian vede cât a durat până s-a predat la execuție.
          finishBrainTurn('lucru')
          // SUPERVIZOR: cerința devine DEȚINUTĂ — rămâne deschisă până la
          // verificare live, nu se închide la „trimis" (Adrian, 5 iul). Numele
          // cerinței = mesajul real, dar dacă a fost doar „da", ia prima linie
          // cu sens din context (nu afișa „da" ca titlu de cerință).
          const ownedTitle = refersToContext
            ? (past.slice(-2, -1)[0]?.replace(/^Kelion:\s*/, '').slice(0, 100) || lastUserText)
            : lastUserText
          // Sarcina COMPLETĂ (cu contextul, dacă mesajul doar referă contextul)
          // se ține pe cerință: la re-asignare, supervizorul trimite agentului
          // proaspăt sarcina reală, nu fragmentul-titlu („reia terminat cu…").
          openRequirement(ownedTitle, dispatchTask, execOrderId)
          updateRequirement('trimisă la constructor')
          if (!a) {
            a = 'Mă ocup — am trimis la execuție. Urmărește progresul pe monitor.'
            emit(a)
          }
        } else {
          // CHAT SIMPLU: proces COMPLET — bara ajunge la 100, stampilăm timpii
          // (tip „chat") și apoi se stinge singură (nu rămâne agățată = fals lucru).
          finishBrainTurn('chat')
        }
      }
      if (!a) {
        // Închide cronometrul turei și pe calea asta (punte căzută → blocul de
        // streaming a fost sărit): fără asta, bara ar rămâne agățată la „Preluare"
        // (turnActive niciodată închis). Idempotent — no-op dacă deja s-a închis.
        finishBrainTurn('chat')
        // NU MAI BUCLEZ (Adrian, 10 iul: „dacă la tura 1 nu întoarce răspuns, nu
        // pleacă încă o tură — revine în chat, pentru clarificări"). Prima tură a
        // tăcut → NU relansez nimic în fundal; mă întorc în chat și cer lămuriri.
        const ro = !langName || /rom/i.test(langName)
        a = bridgeOnline()
          ? ro
            ? 'Nu am scos un răspuns din prima și NU mai reîncerc singur — spune-mi mai clar sau reformulează scurt ce vrei și mă apuc imediat.'
            : "I didn't get a result on the first pass and I won't loop on my own — tell me more clearly or rephrase what you need and I'll get on it."
          : ro
            ? 'Puntea către creier e căzută chiar acum (se repornește singură în câteva secunde). Reia mesajul imediat ce revine — nu bucleez singur.'
            : 'The bridge to the brain is down right now (it restarts itself within seconds). Resend the moment it is back — I will not loop on my own.'
        reply.raw.write(a)
      }
      // Vocea creierului: sintetizată pe server, trimisă prin punte (app doar redă).
      await streamVoice(reply, a, speechPref || user.locale)
      reply.raw.end()
      void saveMessage(user.email, 'assistant', a)
      // MEMORIE PE CALEA PUNȚII (Adrian, 8 iul): distil+save și pe punte,
      // fire-and-forget (nu adaugă latență răspunsului).
      if (lastUserText.trim() || a.trim()) void learnFromTurn(user.email, lastUserText, a)
      return
    }

    // ── PUBLIC PE ABONAMENT (ordin direct Adrian, 10 iul) ───────────────────
    // „Peste tot unde apare Claude se folosește abonamentul mare; cheia API se
    // scoate — altceva e total greșit." Chatul PUBLIC (demo/clienți) nu mai
    // atinge cheia API: răspunde ACELAȘI creier de pe punte (abonamentul), ca la
    // admin — dar cu personaj NEUTRU: jobul pleacă marcat `persona:'public'`,
    // iar workerul NU atașează contextul privat al proprietarului (context.md)
    // la joburile publice, ca proiectul să nu se scurgă către vizitatori.
    // Demo-ul de 3 minute = prima impresie a fiecărui client — trebuie să miște.
    const roPub = userLang.toLowerCase().startsWith('ro')
    // SPEC FREE/DEMO (Adrian, 10 iul): „fără istoric, chat live în orice
    // limbă 3 minute, cameră DA, nimic-admin". Demo = anonim și curat: fără
    // memorie injectată, fără învățare, fără salvare în istoric. Camera DA:
    // cadrul camerei pleacă la creier ca fișier de job (persoana publică).
    const isDemo = user.role === 'demo'
    // Bargraf la intrarea în creier — și pe calea publică (vezi calea admin).
    reply.raw.write(`${CTRL}${JSON.stringify({ heard: lastUserText.slice(0, 500) })}${CTRL}`)
    if (!bridgeOnline()) {
      // Puntea e jos → mesaj cinstit, scurt. NU cădem pe cheia API (ordinul).
      const msg = roPub
        ? 'Creierul meu se repornește chiar acum — durează câteva secunde. Te rog trimite mesajul încă o dată imediat.'
        : 'My brain is restarting right now — it takes a few seconds. Please resend your message in a moment.'
      reply.raw.write(msg)
      await streamVoice(reply, msg, userLang)
      reply.raw.end()
      if (!isDemo) void saveMessage(user.email, 'assistant', msg)
      return
    }
    // Conversația recentă (deja igienizată + plafonată mai sus) + limba +
    // memoria relevantă (scanare DB pură) — pachet subțire, răspuns rapid.
    const past = messages
      .slice(-16)
      .map((m) => `${m.role === 'user' ? 'User' : 'Kelion'}: ${m.content.slice(0, 1200)}`)
      .join('\n')
    // Blocare ABSOLUTĂ de limbă doar când limba e STABILITĂ (preferință de
    // vorbire salvată). Altfel (vizitator nou cu locale implicit 'en' care
    // scrie română) — adaptiv: răspunde în limba în care scrie utilizatorul.
    const langLine =
      speechPref && langName
        ? `Reply EXCLUSIVELY in ${langName} — every sentence, regardless of the language of anything quoted below.`
        : 'Reply in the language the user writes in (default to English for short or ambiguous messages).'
    // GPS-ul vizitatorului (dacă l-a acordat) — pentru hărți/vreme „lângă mine".
    const pubCoords =
      coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)
        ? `Visitor GPS: lat ${coords.lat.toFixed(5)}, lon ${coords.lon.toFixed(5)} — use it for "near me", weather and maps.\n`
        : ''
    const pubPrompt =
      `${langLine}\n` +
      pubCoords +
      // Demo = FĂRĂ memorie/istoric injectat (anonim); doar clienții logați
      // primesc memoria lor relevantă.
      (!isDemo && memRecall.trim() ? `${memRecall.trim().slice(0, 1500)}\n\n` : '') +
      `Conversation so far:\n${past}\n\nAnswer the user's LAST message now.`
    // ── ETICHETE SIGURE PE CALEA PUBLICĂ (Adrian, 10 iul: „free cu toate
    // atributele active") ── aceleași etichete ca la admin, dar DOAR cele care
    // nu cer contul Google al cuiva: [MAP loc], [YT clip], [SHOW doar
    // embed-uri sigure de vreme/trafic], [IMG descriere]. Se execută de pe
    // prima linie a răspunsului (protocolul punții) și se curăță din text.
    const SAFE_SHOW = /^https:\/\/(embed\.waze\.com|embed\.windy\.com)\//i
    const stripPubTags = (s: string): string =>
      s
        .replace(/\[(?:MAP|YT|SHOW|IMG)[^\]]*\]/gi, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
    const runPublicTags = (line: string): string => {
      const mapTag = /\[MAP\s+([^\]]+)\]/i.exec(line)
      if (mapTag) {
        const place = mapTag[1].trim()
        void (async () => {
          let url = config.googleMapsKey
            ? `https://www.google.com/maps/embed/v1/place?key=${config.googleMapsKey}&q=${encodeURIComponent(place)}`
            : ''
          if (!url) {
            try {
              const g = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`,
                { headers: { 'User-Agent': 'Kelionai/1.0 (contact@kelionai.app)' }, signal: AbortSignal.timeout(8000) },
              )
              const arr = (await g.json()) as { lat?: string; lon?: string }[]
              url =
                arr[0]?.lat && arr[0]?.lon
                  ? `https://embed.waze.com/iframe?zoom=12&lat=${arr[0].lat}&lon=${arr[0].lon}`
                  : `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
            } catch {
              url = `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`
            }
          }
          reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title: place } })}${CTRL}`)
        })()
      }
      const ytTag = /\[YT\s+([^\]]+)\]/i.exec(line)
      if (ytTag) {
        const q = ytTag[1].trim()
        void youtubeFirstEmbed(q).then((v) => {
          if (v)
            reply.raw.write(
              `${CTRL}${JSON.stringify({ monitor: { url: v.embed, title: v.title || q } })}${CTRL}`,
            )
        })
      }
      const showTag = /\[SHOW\s+(\S+?)(?:\s*\|\s*([^\]]*))?\]/i.exec(line)
      if (showTag && SAFE_SHOW.test(showTag[1]))
        reply.raw.write(
          `${CTRL}${JSON.stringify({ monitor: { url: showTag[1], title: (showTag[2] || 'Live').slice(0, 60) } })}${CTRL}`,
        )
      const imgTag = /\[IMG\s+([^\]]+)\]/i.exec(line)
      if (imgTag) {
        void generateImage(imgTag[1].trim()).then((result) => {
          if (!('error' in result)) {
            const url = `${baseUrlPub}/api/image/${result.id}`
            reply.raw.write(
              `${CTRL}${JSON.stringify({ monitor: { url, title: imgTag[1].slice(0, 60) }, image: { url } })}${CTRL}`,
            )
          }
        })
      }
      return stripPubTags(line)
    }
    const baseUrlPub = `https://${req.headers.host ?? 'kelionai.app'}`
    // CAMERA în free/public: dacă utilizatorul întreabă ceva ce cere văzul și
    // avem cadrul camerei, îl trimitem ca fișier de job — workerul îl privește
    // cu Read în cutia publică (izolată de a adminului).
    const pubFiles: BridgeFile[] =
      image && (imageIsAttachment || VISION_INTENT.test(lastUserText))
        ? [{ name: imageIsAttachment ? 'atasament.jpg' : 'camera.jpg', type: 'image/jpeg', data: image }]
        : []
    let acc = '' // TOT ce a produs creierul (cu etichete cu tot)
    let shownAny = false
    let headBuf = ''
    let headDone = false
    const showPub = (t: string): void => {
      if (!t) return
      shownAny = true
      reply.raw.write(t)
    }
    // Prima linie poate purta etichete ([MAP]/[YT]/[SHOW]/[IMG]) — o reținem
    // până la newline, executăm etichetele și afișăm textul CURAT; un răspuns
    // fără '[' la început curge de la primul caracter (cazul obișnuit).
    const feedPub = (chunk: string): void => {
      acc += chunk
      if (headDone) {
        showPub(chunk)
        return
      }
      headBuf += chunk
      const s = headBuf.trimStart()
      if (s && !s.startsWith('[')) {
        headDone = true
        showPub(headBuf)
        headBuf = ''
        return
      }
      const nl = headBuf.indexOf('\n')
      if (nl !== -1 || headBuf.length > 300) {
        headDone = true
        const first = nl === -1 ? headBuf : headBuf.slice(0, nl)
        const rest = nl === -1 ? '' : headBuf.slice(nl + 1)
        const spoken = runPublicTags(first)
        showPub(spoken && rest ? `${spoken}\n${rest}` : spoken || rest)
        headBuf = ''
      }
    }
    const answer = await bridgeAskStream(
      pubPrompt,
      pubFiles,
      (chunk) => {
        if (chunk) feedPub(chunk) // '' = puls de viață, nu text
      },
      120_000,
      45_000,
      '',
      'public',
    )
    const rawFull = (answer && answer !== BRIDGE_STALL ? answer : acc).trim()
    if (!rawFull) {
      const msg = roPub
        ? 'Nu am reușit să răspund de data asta — te rog mai încearcă o dată.'
        : "I couldn't answer this time — please try once more."
      reply.raw.write(msg)
      await streamVoice(reply, msg, userLang)
      reply.raw.end()
      if (!isDemo) void saveMessage(user.email, 'assistant', msg)
      return
    }
    // Cap rămas nedescărcat (răspuns scurt, fără newline) → execută + arată.
    if (!headDone && headBuf) {
      headDone = true
      showPub(runPublicTags(headBuf))
      headBuf = ''
    }
    const finalText = stripPubTags(rawFull)
    // Coada nedifuzată (răspunsul final e mai lung decât ce-a curs live).
    if (answer && answer !== BRIDGE_STALL && answer.length > acc.length && answer.startsWith(acc))
      showPub(answer.slice(acc.length))
    else if (!shownAny && finalText) showPub(finalText)
    // Vocea: sintetizată pe server (Chirp 3 HD), în limba utilizatorului —
    // streamVoice curăță singur orice etichetă rămasă.
    await streamVoice(reply, finalText || rawFull, userLang)
    reply.raw.end()
    // Demo = fără urme: nu salvăm istoricul și nu învățăm nimic despre el.
    if (!isDemo) {
      void saveMessage(user.email, 'assistant', finalText || rawFull)
      // Memoria învață și pe calea publică (fire-and-forget, zero latență).
      if (lastUserText.trim()) void learnFromTurn(user.email, lastUserText, finalText || rawFull)
    }
    return
  })
}

// URLs that actually render inside the monitor iframe: our own pages (relative
// or same-host), YouTube (the frontend rewrites to /embed/), Waze's live-map
// embed, OpenStreetMap embeds and Google's keyed Maps Embed API. Everything
// else on the open web almost always sends X-Frame-Options/CSP and would show
// a broken panel — those go through the live browser instead.
function iframeSafe(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return true // relative URL (/api/image/…, /api/route…) — same-origin, safe
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'kelionai.app' || host.endsWith('.kelionai.app')) return true
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return true
  if (host === 'embed.waze.com') return true
  if (host === 'openstreetmap.org') return true
  if (host === 'embed.windy.com' || host === 'windy.com') return true
  if (host === 'wttr.in') return true
  if ((host === 'google.com' || host.endsWith('.google.com')) && u.pathname.startsWith('/maps/embed'))
    return true
  return false
}

// Shared by every browser_* tool: puts the fresh screenshot on the monitor (a
// plain <img>-safe same-origin URL, so it renders even for sites that block
// iframes) and hands Kelion back the page text + numbered clickable elements.
function browserToolResult(
  reply: { raw: { write(chunk: string): void } },
  result: { error: string } | { url: string; title: string; text: string; elements: unknown; shotUrl: string },
): string {
  if ('error' in result) return JSON.stringify(result)
  reply.raw.write(
    `${CTRL}${JSON.stringify({ monitor: { url: result.shotUrl, title: result.title } })}${CTRL}`,
  )
  return JSON.stringify({
    shown: true,
    url: result.url,
    title: result.title,
    text: result.text,
    elements: result.elements,
  })
}
