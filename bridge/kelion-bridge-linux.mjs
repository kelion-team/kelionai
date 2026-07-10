// Kelion admin bridge — Linux/server worker. Runs 24/7 on the Contabo box as a
// systemd service. Pulls the owner's ADMIN messages from kelionai.app and answers
// them with Claude Code on HIS subscription (zero API-key cost). The auth token
// is provided by systemd (CLAUDE_CODE_OAUTH_TOKEN, from /root/kelion/claude.env).
//
// Model failover: Fable 5 is the brain. If a Fable call fails, the SAME request
// is re-served by Opus 4.8 and Fable is rested for 10 minutes; after that it is
// probed again and, once healthy, becomes primary once more — automatically.
//
// ── CHAT LIVE INSTANT (Adrian, 10 iul — construit de-adevăratelea) ──────────
// Trei defecte care făceau chatul să pară mort, reparate AICI:
//  1. SESIUNEA CALDĂ: înainte, FIECARE mesaj pornea un proces `claude` nou și
//     retrimitea TOT contextul (context.md + istoric) — 5-30s până la primul
//     cuvânt. Acum UN proces stă viu: amorsat O dată cu contextul complet, apoi
//     fiecare tură primește DOAR pachetul subțire (job.turn) trimis de server —
//     exact promisiunea din chat.ts care până acum nu era implementată aici.
//  2. ANULARE LA ABANDON: serverul renunță la o tură după 75s fără primul
//     cuvânt, dar workerul nu afla și măcina minute în șir pe un job mort,
//     blocând mesajul următor. Acum fiecare reply-chunk întoarce `gone:true`
//     când serverul nu mai ascultă → tăiem lucrul pe loc, banda se eliberează.
//  3. BENZI SEPARATE: joburile PUBLICE (vizitatori) nu-l mai pun pe Adrian la
//     coadă — banda lui e separată (serial, în ordine); publicul rulează în
//     paralel, plafonat, pe banda proprie.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.KELION_BASE ?? 'https://kelionai.app'
const SECRET = readFileSync('/root/kelion/bridge-secret.txt', 'utf8').trim()
const CLAUDE = 'claude'

// Full project + session memory so this fresh server session knows everything
// (Kelionai, the architecture, what was built, decisions). Prepended to every
// admin message so Kelion never starts "blank". Reloaded on each message so it
// can be updated without restarting the service.
function loadContext() {
  try {
    return readFileSync('/root/kelion/context.md', 'utf8')
  } catch {
    return ''
  }
}

const MODEL = 'claude-fable-5'
const RESERVE = 'claude-opus-4-8'
const REST_MS = 10 * 60_000
let fableDownUntil = 0
const brainModel = () => (Date.now() < fableDownUntil ? RESERVE : MODEL)

// CHAT ONLY. This unattended server worker answers the admin's messages with
// text — it NEVER edits or runs project code (no acceptEdits, no repo). Code
// repairs stay supervised (done with the owner present), never automatically
// from a chat message on a server.
// CHAT INSTANT (Adrian, 10 iul): preambul SCURT, conversațional. Cel vechi îl
// făcea agent care explora serverul (git/journalctl/curl) ~30s înainte să scrie
// un cuvânt — de-aia dura 31s. Acum: răspunde DIRECT din context, fără unelte.
const PREAMBLE = `Ești creierul lui Kelion, pentru adminul tău, Adrian. Mai jos e conversația recentă. Răspunde DIRECT și IMEDIAT la ultimul mesaj al lui Adrian, în limba lui, scurt și la obiect, fără markdown și fără asteriscuri (răspunsul e citit cu voce tare).

Ești conversațional: răspunde pe loc din ce ți se dă în context. NU folosi unelte, NU explora fișiere, NU rula comenzi — doar răspunde. Dacă Adrian cere o reparație/modificare în aplicație, spune-i scurt că te ocupi / ai trimis-o la execuție (n-o face tu aici). Dacă cere ceva ce ține de uneltele live ale lui Kelion (hărți, monitor, imagini, pagini), spune-i să înceapă mesajul cu „Kelion". Nu spune niciodată „nu pot" — dă mereu un răspuns real și util, pe loc.

Conversația:
`

// PUBLIC (ordin direct Adrian, 10 iul: „peste tot abonamentul mare"): joburile
// marcate persona:'public' vin de la VIZITATORI/CLIENȚI, nu de la proprietar.
// NU primesc context.md (proiectul privat NU se scurge către străini) și au
// personajul neutru Kelion — politicos, direct, în limba utilizatorului.
const PUBLIC_PREAMBLE = `You are Kelion — a refined, courteous personal AI assistant: a well-mannered gentleman with a first-class mind. The conversation below is with a VISITOR or CUSTOMER (not your owner). Answer their LAST message DIRECTLY and IMMEDIATELY, briefly and to the point, in the language the instructions below specify. Plain spoken sentences only — NO markdown, NO asterisks, NO bullet lists, NO emoji (your words are read ALOUD). Do not use tools, do not explore files, do not run commands — just answer from what you are given. NEVER mention your owner, his name, his project, this server, or any internal detail. If an IMAGE FILE is attached below, LOOK at it with your Read tool before answering — it is the visitor's live camera.

YOU CAN SHOW THINGS on the visitor's monitor with TAGS placed on the FIRST LINE of your reply (your spoken text starts from line 2). Available tags:
- [MAP place name] — shows a live map (e.g. [MAP Eiffel Tower Paris]).
- [YT what to play] — starts a real YouTube video (NEVER invent links or IDs — just name it, the server finds the real clip).
- [SHOW https://embed.windy.com/embed2.html?lat=LAT&lon=LON | Weather] — live weather map, when you know coordinates (visitor GPS may be provided).
- [IMG detailed English description] — generates an image and shows it.
Use a tag WHENEVER the visitor asks to SEE something (a place, a video, the weather, a picture). NEVER claim something is on screen without its tag. For tools that need a personal account (email, calendar), kindly say they become available after signing up.

`

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

// FIȘIERE ATAȘATE (Adrian, 10 iul: „dacă trimit poza cu textul nu merge").
// Cauza: jobul PURTA fișierele (job.files), dar workerul le ignora complet, deci
// pozele nu ajungeau niciodată la creier. Acum le scriem pe disc în /root/kelion
// (deja în --add-dir) și-i spunem creierului calea, ca să le citească/privească.
const INBOX = '/root/kelion/inbox'
// Cutia PUBLICĂ e separată de a adminului: camera vizitatorului (demo are voie
// să vadă — spec Adrian, 10 iul) se scrie în /tmp, iar Read primește DOAR acest
// folder — niciodată /root/kelion.
const PUB_INBOX = '/tmp/kelion-public-inbox'
function saveJobFiles(job, isPublic = false) {
  const files = Array.isArray(job.files) ? job.files : []
  if (!files.length) return ''
  const dir = isPublic ? PUB_INBOX : INBOX
  const paths = []
  try {
    mkdirSync(dir, { recursive: true })
  } catch {}
  for (const f of files) {
    try {
      const b64 = String(f?.data || '').split(',').pop() || ''
      if (!b64) continue
      const safe = String(f?.name || 'fisier').replace(/[^\w.\-]+/g, '_').slice(0, 80)
      const p = `${dir}/${job.id.slice(0, 8)}_${safe}`
      writeFileSync(p, Buffer.from(b64, 'base64'))
      paths.push(p)
    } catch (e) {
      log(`nu am putut scrie un fisier atasat: ${e.message}`)
    }
  }
  if (!paths.length) return ''
  log(`${paths.length} fisier(e) atasat(e) scrise pentru creier${isPublic ? ' (public)' : ''}.`)
  return isPublic
    ? `\n\nIMAGE ATTACHED — the visitor's camera frame. LOOK at it with your Read tool BEFORE answering:\n${paths.map((p) => `- ${p}`).join('\n')}\n`
    : `\n\nFIȘIERE ATAȘATE de Adrian (citește-le/privește-le cu uneltele tale — Read — ÎNAINTE să răspunzi):\n${paths.map((p) => `- ${p}`).join('\n')}\n`
}

// ── ANULARE LA ABANDON ──────────────────────────────────────────────────────
// Un jeton pe job: serverul semnalează prin `gone:true` (pe răspunsul fiecărui
// reply-chunk) că nu mai ascultă tura → cancel() taie procesul claude atașat.
// Fără asta, un job abandonat ținea banda ocupată minute în șir („se blochează").
function makeCancel() {
  let target = null
  let cancelled = false
  return {
    get cancelled() {
      return cancelled
    },
    attach(t) {
      target = t
      if (cancelled) {
        try {
          t.kill()
        } catch {}
      }
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      try {
        target?.kill()
      } catch {}
    },
  }
}

// VITEZA MAXIMĂ (Adrian, 10 iul: „creierul Linux e foarte încet"). Cauza reală:
// modul `--output-format text` aștepta ÎNTREG răspunsul (60–90s) și-l trimitea
// dintr-o dată — Adrian se holba la „analizează 30%" fără nimic, apoi apărea tot.
// Acum STREAM: cuvintele curg pe măsură ce creierul le scrie (primul cuvânt în
// ~2s), exact ce așteaptă puntea (reply-chunk → bara sare la 65%, textul curge).
// `onChunk(text)` primește fiecare bucată; întoarce textul COMPLET (sau null).
// Argumente CLI. Chat PUR = FĂRĂ unelte → modelul răspunde direct din context,
// primul cuvânt în ~2s (nu mai explorează serverul 30s). Cu POZĂ atașată =
// permite DOAR Read pe folderul de poze, ca să le poată privi. Peste tot tăiem
// secțiunile dinamice uriașe din promptul implicit → prefill mult mai mic.
function claudeArgs({ streaming, model, hasFiles, pub }) {
  const args = ['-p']
  if (streaming) args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages')
  else args.push('--output-format', 'text')
  // CHAT PUR: NU grantăm unelte și NU dăm --add-dir. Cauza reală a celor 31s era
  // --add-dir /root/kelion (repo întreg de explorat) + unelte. Fără ele, modelul
  // răspunde direct din context (instant). Folosim DOAR flag-uri dovedite — flag-
  // urile noi (--disallowedTools/--exclude-dynamic...) lipseau din CLI-ul de pe
  // VPS și RUPEAU workerul (niciun răspuns). Cu POZĂ: Read + folderul de poze —
  // pentru joburi PUBLICE doar cutia publică din /tmp, NICIODATĂ /root/kelion.
  if (hasFiles) args.push('--allowedTools', 'Read', '--add-dir', pub ? PUB_INBOX : INBOX)
  if (model) args.push('--model', model)
  return args
}

// cwd NEUTRU pentru joburile PUBLICE: `claude -p` își încarcă automat CLAUDE.md
// și contextul din directorul curent — un job de vizitator pornit din
// /root/kelion ar primi pe furiș contextul privat. Public → rulează din /tmp.
const spawnOpts = (pub) => (pub ? { env: process.env, cwd: '/tmp' } : { env: process.env })

// ── SESIUNEA CALDĂ (chatul adminului) ───────────────────────────────────────
// UN proces `claude` viu, în modul conversație (stream-json pe stdin): prima
// tură îl amorsează cu contextul complet (context.md + preambul + pachetul
// serverului), turele următoare trimit DOAR job.turn — fără pornire la rece,
// fără context retrimis. Dacă CLI-ul de pe VPS nu ține procesul viu după prima
// tură, sesiunea „moare" curat și tura următoare amorsează una nouă — adică
// exact comportamentul de azi, niciodată mai rău.
const WARM_MAX_TURNS = 30 // reciclare: conversația din proces să nu crească la nesfârșit
let warm = null

function startWarm(model) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]
  if (model) args.push('--model', model)
  let child
  try {
    child = spawn(CLAUDE, args, spawnOpts(false))
  } catch {
    return null
  }
  let turn = null // tura în zbor: { onChunk, resolve, streamed, timer }
  // Sfârșit de tură: normal (cu textul final) sau avariat (cu ce a curs — un
  // răspuns parțial se livrează, nu se aruncă și nu se regenerează în dublu).
  const endTurn = (text) => {
    if (!turn) return
    const t = turn
    turn = null
    clearTimeout(t.timer)
    t.resolve((text ?? t.streamed).trim() || null)
  }
  const s = {
    alive: true,
    turns: 0,
    model,
    kill() {
      s.alive = false
      try {
        child.kill()
      } catch {}
      endTurn(null)
    },
    ask(text, onChunk, timeoutMs = 90_000) {
      return new Promise((resolve) => {
        if (!s.alive || turn) {
          resolve(null)
          return
        }
        s.turns++
        turn = {
          onChunk,
          resolve,
          streamed: '',
          // Tura agățată → sesiunea moare (o generare pornită nu se poate opri
          // altfel); ce a curs până atunci se livrează, iar tura următoare
          // amorsează o sesiune nouă.
          timer: setTimeout(() => s.kill(), timeoutMs),
        }
        try {
          child.stdin.write(
            `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`,
          )
        } catch {
          s.kill()
        }
      })
    },
  }
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d.toString()
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line || !turn) continue
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      if (
        ev.type === 'stream_event' &&
        ev.event?.type === 'content_block_delta' &&
        ev.event.delta?.type === 'text_delta'
      ) {
        const t = ev.event.delta.text || ''
        if (t) {
          turn.streamed += t
          turn.onChunk?.(t)
        }
      } else if (ev.type === 'result') {
        const final = typeof ev.result === 'string' ? ev.result.trim() : ''
        const full = final.length >= turn.streamed.trim().length ? final : turn.streamed.trim()
        // Coada nedifuzată (finalul e mai lung decât ce-a curs) pleacă și ea.
        if (full && full.length > turn.streamed.length && full.startsWith(turn.streamed)) {
          turn.onChunk?.(full.slice(turn.streamed.length))
        }
        endTurn(full || null)
      }
    }
  })
  child.stderr.on('data', () => {})
  child.on('close', () => {
    s.alive = false
    endTurn(null)
  })
  child.on('error', () => {
    s.alive = false
    endTurn(null)
  })
  return s
}

// Tura adminului pe sesiunea caldă. null = nu s-a putut (se cade pe cascada
// veche, cu prompt complet — comportamentul de azi, deci niciodată mai rău).
function askWarm(job, onChunk, cancel) {
  if (!job.turn) return Promise.resolve(null) // server vechi, fără pachet subțire
  if (warm && (!warm.alive || warm.turns >= WARM_MAX_TURNS || warm.model !== brainModel())) {
    warm.kill()
    warm = null
  }
  let text
  if (!warm) {
    warm = startWarm(brainModel())
    if (!warm) return Promise.resolve(null)
    // Amorsare + prima tură dintr-o mișcare: pachetul complet al serverului
    // (context + istoric + mesajul nou) — răspunsul amorsării E răspunsul turei.
    log(`Sesiune caldă nouă (model ${warm.model}) — amorsez cu contextul complet.`)
    text = loadContext() + '\n\n' + PREAMBLE + job.prompt
  } else {
    text = job.turn
  }
  const s = warm
  // Abandon de la server → sesiunea se taie (tura pornită nu se poate opri
  // altfel); următoarea tură amorsează una proaspătă.
  cancel?.attach({ kill: () => s.kill() })
  return s.ask(text, onChunk)
}

function runClaudeStream(prompt, { timeoutMs, model, onChunk, hasFiles, pub, cancel } = {}) {
  return new Promise((resolve) => {
    const args = claudeArgs({ streaming: true, model, hasFiles, pub })
    const child = spawn(CLAUDE, args, spawnOpts(pub))
    cancel?.attach(child)
    let streamed = '' // ce am trimis deja prin onChunk (bucățile difuzate)
    let finalText = '' // răspunsul autoritar din evenimentul `result`
    let buf = ''
    let err = ''
    const killer = setTimeout(() => {
      child.kill()
      resolve((finalText || streamed).trim() || null)
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        // Token-uri parțiale (creierul scrie ACUM) → difuzează-le pe loc.
        if (
          ev.type === 'stream_event' &&
          ev.event?.type === 'content_block_delta' &&
          ev.event.delta?.type === 'text_delta'
        ) {
          const t = ev.event.delta.text || ''
          if (t) {
            streamed += t
            onChunk?.(t)
          }
        } else if (ev.type === 'result' && typeof ev.result === 'string') {
          // Răspunsul final complet (autoritar). Îl păstrăm pe cel mai lung.
          if (ev.result.trim().length > finalText.trim().length) finalText = ev.result
        }
      }
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => {
      clearTimeout(killer)
      const full = (finalText.trim().length >= streamed.trim().length ? finalText : streamed).trim()
      // Dacă finalul e mai lung decât ce-am difuzat (și e o continuare curată),
      // trimite coada lipsă ca ultimă bucată — să nu piardă Adrian sfârșitul.
      if (full && full.length > streamed.length && full.startsWith(streamed)) {
        const tail = full.slice(streamed.length)
        if (tail) onChunk?.(tail)
      }
      if (!full && err.trim()) log(`claude stderr: ${err.trim().slice(0, 200)}`)
      resolve(full || null)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// PLASĂ DE SIGURANȚĂ: modul text vechi (dovedit), fără streaming. Folosit doar
// dacă streamingul nu scoate nimic (versiune de CLI fără `stream-json`) — așa
// nu coborâm NICIODATĂ sub comportamentul de azi.
function runClaudeText(prompt, { timeoutMs, model, hasFiles, pub, cancel } = {}) {
  return new Promise((resolve) => {
    const args = claudeArgs({ streaming: false, model, hasFiles, pub })
    const child = spawn(CLAUDE, args, spawnOpts(pub))
    cancel?.attach(child)
    let out = ''
    let err = ''
    const killer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => {
      clearTimeout(killer)
      if (out.trim()) resolve(out.trim())
      else {
        if (err.trim()) log(`claude stderr: ${err.trim().slice(0, 200)}`)
        resolve(null)
      }
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// Chat cu streaming + failover de model. Încearcă Fable (dacă nu se odihnește),
// stream; dacă streamul nu scoate text, cade pe modul text (aceeași cerere);
// dacă tot nimic și eram pe Fable, trece pe Opus și odihnește Fable 10 min.
// `cancel` oprește cascada pe loc când serverul a abandonat tura — nu mai
// ardem minute pe un job pe care nu-l mai așteaptă nimeni.
async function askClaude(prompt, onChunk, hasFiles, isPublic, cancel) {
  const model = brainModel()
  // Jobul PUBLIC nu primește NICIODATĂ context.md (privat) — doar personajul
  // neutru. Jobul adminului primește tot contextul, ca până acum.
  // CONTRADICȚIA POZELOR (Adrian, 10 iul: „kelion nu primește poze cu scris"):
  // PREAMBLE interzice uneltele (viteza), dar nota de fișiere cere Read — modelul
  // asculta interdicția și IGNORA poza. Cu fișiere atașate, excepția devine
  // explicită și mai puternică decât interdicția.
  const FILES_EXCEPTION = hasFiles
    ? '\n\nEXCEPȚIE OBLIGATORIE LA REGULA FĂRĂ UNELTE: acest mesaj ARE FIȘIERE ATAȘATE (căile sunt mai jos). FOLOSEȘTE unealta Read ca să le vezi/citești ÎNAINTE să răspunzi — asta anulează, doar pentru fișierele atașate, orice interdicție de unelte de mai sus.\n'
    : ''
  const full = isPublic
    ? PUBLIC_PREAMBLE + prompt
    : loadContext() + '\n\n' + PREAMBLE + FILES_EXCEPTION + prompt
  // Buget de timp MĂRGINIT (Adrian, 10 iul + audit): serverul renunță la 75s și
  // maxTries=1, deci n-are rost să măcinăm minute pe un job pe care serverul
  // deja l-a uitat. Chatul fără unelte răspunde în ~2s, deci pragurile astea nu
  // se ating decât la rațiune grea; cascada e scurtă, nu 4×120s ca înainte.
  let answer = await runClaudeStream(full, { timeoutMs: 90_000, model, onChunk, hasFiles, pub: isPublic, cancel })
  if (cancel?.cancelled) return answer
  if (!answer) answer = await runClaudeText(full, { timeoutMs: 45_000, model, hasFiles, pub: isPublic, cancel })
  if (cancel?.cancelled) return answer
  if (!answer && model === MODEL) {
    fableDownUntil = Date.now() + REST_MS
    log('Fable a esuat — trec pe Opus, revin la Fable in 10 min.')
    answer = await runClaudeStream(full, { timeoutMs: 90_000, model: RESERVE, onChunk, hasFiles, pub: isPublic, cancel })
  }
  if (cancel?.cancelled) return answer
  // PLASĂ FINALĂ GARANTATĂ (Adrian, 10 iul: „să nu se mai poată strica"): dacă TOT
  // n-a ieșit nimic (ex. un flag pe care versiunea de CLI de aici nu-l cunoaște,
  // exact ce a rupt chatul), încearcă o comandă MINIMALĂ absolută — doar `claude
  // -p`, fără NICIUN flag opțional. Orice versiune de CLI o suportă, deci un flag
  // prost nu mai poate lăsa NICIODATĂ chatul complet mut.
  if (!answer) answer = await runClaudeBare(full, 60_000, isPublic, cancel)
  return answer
}

// Comanda cea mai simplă cu putință — plasa de siguranță. Fără output-format,
// fără unelte, fără model: doar text din stdin. Dacă și asta tace, chiar nu se
// poate (CLI/abonament căzut), și abia atunci serverul dă mesajul cinstit.
function runClaudeBare(prompt, timeoutMs = 60_000, pub = false, cancel) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE, ['-p'], spawnOpts(pub))
    } catch {
      resolve(null)
      return
    }
    cancel?.attach(child)
    let out = ''
    const killer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      resolve(out.trim() || null)
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => {
      clearTimeout(killer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(killer)
      resolve(out.trim() || null)
    })
    try {
      child.stdin.write(prompt)
      child.stdin.end()
    } catch {
      /* ignore */
    }
  })
}

async function pull() {
  // Timeout obligatoriu: fără el, un sughiț de rețea lăsa fetch-ul agățat pe
  // veci și bucla murea „vie" — puntea părea căzută (4 iul). Long-poll = 25s.
  const res = await fetch(`${BASE}/api/bridge/pull`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    // Declaram CAPABILITATEA persona: serverul da joburi PUBLICE doar workerilor
    // care o declara — zombii/vechii (body gol) nu mai pot primi vizitatori.
    body: JSON.stringify({ caps: ['persona'] }),
    signal: AbortSignal.timeout(40_000),
  })
  if (res.status === 401) throw new Error('Secret respins de server')
  if (!res.ok) throw new Error(`pull HTTP ${res.status}`)
  const j = await res.json()
  const job = j.job ?? null
  // Confirmare de primire — serverul relivrează jobul dacă nu vede ack-ul.
  if (job) {
    void fetch(`${BASE}/api/bridge/ack`, {
      method: 'POST',
      headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {})
  }
  return job
}

async function sendReply(id, text) {
  await fetch(`${BASE}/api/bridge/reply`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text }),
    signal: AbortSignal.timeout(30_000),
  })
}

// Un job, cap-coadă: streaming spre punte + puls de viață + anulare la abandon.
async function handleJob(job) {
  const isPub = job.persona === 'public'
  log(`${isPub ? 'Mesaj public' : 'Mesaj admin'} (${job.id.slice(0, 8)}) — model ${brainModel()}...`)
  const t0 = Date.now()
  let firstAt = 0
  const cancel = makeCancel()
  // BUCĂȚILE difuzate se strâng într-un tampon și se trimit la ~150ms (coalesced)
  // ca să nu inundăm puntea cu zeci de POST-uri, dar textul tot curge live.
  let pending = ''
  const post = (body) =>
    fetch(`${BASE}/api/bridge/reply-chunk`, {
      method: 'POST',
      headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => r.json())
      .then((j) => {
        // Serverul a abandonat tura (stall/timeout) → nu mai ardem nicio
        // secundă pe ea; banda se eliberează pentru mesajul următor.
        if (j && j.gone) cancel.cancel()
      })
      .catch(() => {})
  const flush = () => {
    if (!pending) return
    const text = pending
    pending = ''
    void post({ id: job.id, text })
  }
  const onChunk = (t) => {
    if (!firstAt) firstAt = Date.now()
    pending += t
  }
  // La 150ms: dacă a curs text, trimite-l; altfel PULS DE VIAȚĂ (creierul
  // gândește) — ține tura vie cât timp Claude chiar lucrează (răspunsurile de
  // 30–80s mureau altfel). Ambele merg pe reply-chunk. Puls la 3s (nu 9):
  // răspunsul lui `gone` e și ceasul ANULĂRII — un job abandonat de server se
  // taie acum în ~3s, nu după 9.
  let sinceBeat = 0
  const pulse = setInterval(() => {
    if (pending) {
      flush()
      sinceBeat = 0
    } else if ((sinceBeat += 150) >= 3000) {
      sinceBeat = 0
      void post({ id: job.id, keepalive: true })
    }
  }, 150)
  let answer
  try {
    // Atașează pozele/fișierele jobului (dacă există) la prompt. Doar când
    // există fișiere permitem Read (ca să le privească); altfel chat pur, fără
    // unelte → instant.
    // GARD: joburile publice nu primesc NICIODATĂ fișiere/Read pe inbox —
    // uneltele și fișierele sunt doar pentru admin.
    const isPubJob = job.persona === 'public'
    // Camera vizitatorului e permisa (spec 10 iul) — dar DOAR prin cutia publica
    // din /tmp; fisierele adminului raman in cutia lui privata.
    const fileNote = saveJobFiles(job, isPubJob)
    // ADMIN fără fișiere → SESIUNEA CALDĂ (pachet subțire, primul cuvânt rapid).
    // Cu fișiere (are nevoie de Read) sau PUBLIC (izolare) → proces proaspăt.
    if (!isPubJob && !fileNote) answer = await askWarm(job, onChunk, cancel)
    if (!answer && !cancel.cancelled) {
      answer = await askClaude(job.prompt + fileNote, onChunk, fileNote !== '', isPubJob, cancel)
    }
  } finally {
    clearInterval(pulse)
    flush() // orice bucată rămasă în tampon pleacă acum
  }
  if (cancel.cancelled) {
    await sendReply(job.id, '').catch(() => {})
    log(`Tura ${job.id.slice(0, 8)} abandonată de server — am tăiat lucrul, banda e liberă.`)
    return
  }
  if (answer) {
    await sendReply(job.id, answer)
    const totalMs = Date.now() - t0
    const firstMs = firstAt ? firstAt - t0 : 0
    log(`Raspuns trimis (${answer.length} car, ${totalMs}ms, primul cuvant ${firstMs || '—'}ms).`)
  } else {
    await sendReply(job.id, '')
    log('Fara raspuns — serverul isi raspunde singur la acest mesaj.')
  }
}

// ── BENZI SEPARATE ──────────────────────────────────────────────────────────
// Adminul: banda lui, STRICT în ordine (o conversație = o tură pe rând).
// Publicul: banda lui, max 2 în paralel — un val de vizitatori nu-l mai pune
// pe Adrian la coadă, iar bucla de pull nu se mai oprește cât timp se lucrează.
let adminChain = Promise.resolve()
let publicActive = 0
const PUBLIC_MAX = 2
const publicWaiters = []
async function acquirePublic() {
  if (publicActive < PUBLIC_MAX) {
    publicActive++
    return
  }
  await new Promise((r) => publicWaiters.push(r))
  publicActive++
}
function releasePublic() {
  publicActive--
  const w = publicWaiters.shift()
  if (w) w()
}

log(`Puntea non-stop PORNITA -> ${BASE} (model principal ${MODEL}, rezerva ${RESERVE})`)
for (;;) {
  try {
    const job = await pull()
    if (!job) continue
    if (job.kind === 'repair') {
      // Repairs are NOT executed by this unattended server worker (safety).
      // Return empty so the request is handled supervised elsewhere.
      await sendReply(job.id, '')
      log(`Reparatie ignorata pe server (se fac supravegheat): ${job.id.slice(0, 8)}`)
      continue
    }
    if (job.persona === 'public') {
      void (async () => {
        await acquirePublic()
        try {
          await handleJob(job)
        } catch (e) {
          log(`Eroare pe tura publica ${job.id.slice(0, 8)}: ${e.message}`)
          await sendReply(job.id, '').catch(() => {})
        } finally {
          releasePublic()
        }
      })()
    } else {
      adminChain = adminChain
        .then(() => handleJob(job))
        .catch(async (e) => {
          log(`Eroare pe tura admin ${job.id.slice(0, 8)}: ${e.message}`)
          await sendReply(job.id, '').catch(() => {})
        })
    }
  } catch (e) {
    // 3s, nu 10s (Adrian: „se blochează") — un sughiț de rețea nu mai lasă
    // puntea moartă zece secunde; long-poll-ul oricum absoarbe graba.
    log(`Eroare: ${e.message} — reincerc in 3s`)
    await new Promise((r) => setTimeout(r, 3000))
  }
}
