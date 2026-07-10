// Kelion admin bridge — Linux/server worker. Runs 24/7 on the Contabo box as a
// systemd service. Pulls the owner's ADMIN messages from kelionai.app and answers
// them with Claude Code on HIS subscription (zero API-key cost). The auth token
// is provided by systemd (CLAUDE_CODE_OAUTH_TOKEN, from /root/kelion/claude.env).
//
// Model failover: Fable 5 is the brain. If a Fable call fails, the SAME request
// is re-served by Opus 4.8 and Fable is rested for 10 minutes; after that it is
// probed again and, once healthy, becomes primary once more — automatically.
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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

// FIȘIERE ATAȘATE (Adrian, 10 iul: „dacă trimit poza cu textul nu merge").
// Cauza: jobul PURTA fișierele (job.files), dar workerul le ignora complet, deci
// pozele nu ajungeau niciodată la creier. Acum le scriem pe disc în /root/kelion
// (deja în --add-dir) și-i spunem creierului calea, ca să le citească/privească.
const INBOX = '/root/kelion/inbox'
function saveJobFiles(job) {
  const files = Array.isArray(job.files) ? job.files : []
  if (!files.length) return ''
  const paths = []
  try {
    mkdirSync(INBOX, { recursive: true })
  } catch {}
  for (const f of files) {
    try {
      const b64 = String(f?.data || '').split(',').pop() || ''
      if (!b64) continue
      const safe = String(f?.name || 'fisier').replace(/[^\w.\-]+/g, '_').slice(0, 80)
      const p = `${INBOX}/${job.id.slice(0, 8)}_${safe}`
      writeFileSync(p, Buffer.from(b64, 'base64'))
      paths.push(p)
    } catch (e) {
      log(`nu am putut scrie un fisier atasat: ${e.message}`)
    }
  }
  if (!paths.length) return ''
  log(`${paths.length} fisier(e) atasat(e) scrise pentru creier.`)
  return `\n\nFIȘIERE ATAȘATE de Adrian (citește-le/privește-le cu uneltele tale — Read — ÎNAINTE să răspunzi):\n${paths.map((p) => `- ${p}`).join('\n')}\n`
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
function claudeArgs({ streaming, model, hasFiles }) {
  const args = ['-p']
  if (streaming) args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages')
  else args.push('--output-format', 'text')
  // CHAT PUR: NU grantăm unelte și NU dăm --add-dir. Cauza reală a celor 31s era
  // --add-dir /root/kelion (repo întreg de explorat) + unelte. Fără ele, modelul
  // răspunde direct din context (instant). Folosim DOAR flag-uri dovedite — flag-
  // urile noi (--disallowedTools/--exclude-dynamic...) lipseau din CLI-ul de pe
  // VPS și RUPEAU workerul (niciun răspuns). Cu POZĂ: Read + folderul de poze.
  if (hasFiles) args.push('--allowedTools', 'Read', '--add-dir', INBOX)
  if (model) args.push('--model', model)
  return args
}

function runClaudeStream(prompt, { timeoutMs, model, onChunk, hasFiles } = {}) {
  return new Promise((resolve) => {
    const args = claudeArgs({ streaming: true, model, hasFiles })
    const child = spawn(CLAUDE, args, { env: process.env })
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
function runClaudeText(prompt, { timeoutMs, model, hasFiles } = {}) {
  return new Promise((resolve) => {
    const args = claudeArgs({ streaming: false, model, hasFiles })
    const child = spawn(CLAUDE, args, { env: process.env })
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

// ── CREIER CALD: sesiune `claude` PERMANENTĂ (sub 1s la lucruri simple) ──────
// Adrian, 10 iul: „chat live gândit; răspuns ultra rapid, sub 1s la lucruri
// simple; dacă e nevoie de ceva, DOAR atunci se caută în istoric." Zidul de
// ~2-3s era procesul `claude` pornit DE LA ZERO la fiecare mesaj (spawn + auth +
// reconectare model + reîncărcarea întregului context ca prefill). Aici ținem UN
// SINGUR proces `claude` VIU, în mod stream-json intrare+ieșire: îl amorsăm O
// DATĂ cu tot contextul, apoi fiecare tură trimite DOAR mesajul nou → primul
// cuvânt ține doar de model (sub 1s). Istoricul se caută „la nevoie": backendul
// bagă în pachetul turei doar memoria relevantă (scanare DB), nu tot contextul.
//
// PLASĂ (Adrian: „să nu se mai poată strica"): dacă versiunea de CLI de pe VPS NU
// suportă modul ăsta (procesul iese pe loc / nu scoate stream-json), sau sesiunea
// moare — cădem AUTOMAT pe calea veche dovedită (proces nou + cascadă). După 2
// eșecuri la rând oprim complet încercările calde. În cel mai rău caz = ca azi.
const WARM_ENABLED = process.env.KELION_WARM !== '0' // urgență: KELION_WARM=0 dezactivează tot

class WarmBrain {
  constructor() {
    this.child = null
    this.model = null
    this.ready = false
    this.primed = false // amorsat cu tot contextul? (prima tură a sesiunii)
    this.turns = 0 // câte ture a dus sesiunea (pentru reamorsare periodică)
    this.busy = false
    this.buf = ''
    this.onLine = null
    this.abortTurn = null
  }
  start(model) {
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
      child = spawn(CLAUDE, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      return false
    }
    this.child = child
    this.model = model
    this.ready = true // procesul e sus; „primed" se face la prima cerere
    this.primed = false
    this.buf = ''
    child.stdout.on('data', (d) => {
      this.buf += d.toString()
      let nl
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        this.onLine?.(ev)
      }
    })
    child.stderr.on('data', () => {})
    const die = () => {
      this.ready = false
      this.child = null
      const a = this.abortTurn
      this.abortTurn = null
      a?.() // dacă o tură aștepta, o închidem pe loc → fallback rapid
    }
    child.on('close', die)
    child.on('error', die)
    return true
  }
  // Trimite un mesaj pe sesiunea vie; streamează tokenii prin onChunk.
  // Rezolvă { text, clean }: clean=true doar dacă tura s-a terminat curat
  // (eveniment `result` sau liniște după stream); necurat → apelantul repornește.
  ask(text, onChunk, timeoutMs) {
    return new Promise((resolve) => {
      if (!this.ready || !this.child || this.busy) {
        resolve({ text: null, clean: false })
        return
      }
      this.busy = true
      let streamed = ''
      let finalText = ''
      let done = false
      let idleTimer = null
      const finish = (val, clean) => {
        if (done) return
        done = true
        clearTimeout(killer)
        if (idleTimer) clearTimeout(idleTimer)
        this.onLine = null
        this.abortTurn = null
        this.busy = false
        resolve({ text: val, clean })
      }
      // Buget total (până la primul semn de viață). Dacă modul nu e suportat,
      // procesul iese și `die` închide tura instant — nu așteptăm degeaba.
      const killer = setTimeout(() => finish((finalText || streamed).trim() || null, false), timeoutMs)
      this.abortTurn = () => finish((finalText || streamed).trim() || null, false)
      // Dacă versiunea de CLI nu emite `result` per tură, închidem tura după o
      // liniște de 2s de la ultimul token (răspunsul curge oricum live la Adrian).
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => finish((finalText || streamed).trim() || null, true), 2000)
      }
      this.onLine = (ev) => {
        if (
          ev.type === 'stream_event' &&
          ev.event?.type === 'content_block_delta' &&
          ev.event.delta?.type === 'text_delta'
        ) {
          const t = ev.event.delta.text || ''
          if (t) {
            streamed += t
            onChunk?.(t)
            armIdle()
          }
        } else if (ev.type === 'result' && typeof ev.result === 'string') {
          if (ev.result.trim().length > finalText.trim().length) finalText = ev.result
          const full = (finalText.trim().length >= streamed.trim().length ? finalText : streamed).trim()
          if (full && full.length > streamed.length && full.startsWith(streamed)) {
            const tail = full.slice(streamed.length)
            if (tail) onChunk?.(tail)
          }
          finish(full || null, true)
        }
      }
      try {
        this.child.stdin.write(
          JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n',
        )
      } catch {
        finish(null, false)
      }
    })
  }
  kill() {
    try {
      this.child?.kill()
    } catch {}
    this.child = null
    this.ready = false
    this.primed = false
  }
}

let warm = null
let warmFails = 0
let warmDisabled = false
function ensureWarm(model) {
  if (!WARM_ENABLED || warmDisabled) return null
  if (warm && warm.ready && warm.model === model) return warm
  if (warm) warm.kill()
  warm = new WarmBrain()
  if (!warm.start(model)) {
    warm = null
    return null
  }
  return warm
}

// Chat: mai întâi CREIERUL CALD (sub 1s); dacă nu-l avem/eșuează → cascada veche
// dovedită (Fable stream → text → Opus → `claude -p` gol). Jobs cu fișiere (poze)
// rămân DIRECT pe calea veche cu Read — nu riscăm sesiunea caldă acolo.
async function askClaude(prompt, onChunk, hasFiles, turnText) {
  const model = brainModel()

  if (WARM_ENABLED && !warmDisabled && !hasFiles) {
    let w = ensureWarm(model)
    // Reamorsare periodică: după WARM_MAX_TURNS ture, reîncepem sesiunea ca să nu
    // crească istoricul la nesfârșit (ar încetini). Conversația recentă revine din
    // contextul de amorsare (bridgePrompt), deci nu se pierde nimic important.
    const WARM_MAX_TURNS = 40
    if (w && w.ready && w.primed && w.turns >= WARM_MAX_TURNS) {
      w.kill()
      w = ensureWarm(model)
    }
    if (w && w.ready) {
      const primed = w.primed
      // Amorsare O DATĂ cu tot contextul; apoi DOAR mesajul nou (pachet subțire).
      const payload = primed && turnText ? turnText : loadContext() + '\n\n' + PREAMBLE + prompt
      const { text: ans, clean } = await w.ask(payload, onChunk, primed ? 45_000 : 75_000)
      if (ans && clean) {
        w.primed = true
        w.turns += 1
        warmFails = 0
        return ans
      }
      // Necurat / gol → sesiunea e într-o stare incertă: o oprim (repornește la
      // următoarea tură). Dacă a difuzat PARȚIAL înainte să pice, `ans` e acel
      // parțial (îl păstrăm, fără dublare). Dacă e null = ZERO difuzat → sigur
      // de reluat pe calea veche. După 2 eșecuri goale la rând, oprim caldul.
      w.kill()
      if (ans) return ans
      if (++warmFails >= 2) {
        warmDisabled = true
        log('Creier cald indisponibil (2 esecuri) — trec pe calea dovedita in acest worker.')
      }
    }
  }

  // ── CALEA VECHE DOVEDITĂ (fallback garantat) ──
  const full = loadContext() + '\n\n' + PREAMBLE + prompt
  let answer = await runClaudeStream(full, { timeoutMs: 90_000, model, onChunk, hasFiles })
  if (!answer) answer = await runClaudeText(full, { timeoutMs: 45_000, model, hasFiles })
  if (!answer && model === MODEL) {
    fableDownUntil = Date.now() + REST_MS
    log('Fable a esuat — trec pe Opus, revin la Fable in 10 min.')
    answer = await runClaudeStream(full, { timeoutMs: 90_000, model: RESERVE, onChunk, hasFiles })
  }
  // PLASĂ FINALĂ GARANTATĂ (Adrian, 10 iul: „să nu se mai poată strica"): dacă TOT
  // n-a ieșit nimic (ex. un flag pe care versiunea de CLI de aici nu-l cunoaște,
  // exact ce a rupt chatul), încearcă o comandă MINIMALĂ absolută — doar `claude
  // -p`, fără NICIUN flag opțional. Orice versiune de CLI o suportă, deci un flag
  // prost nu mai poate lăsa NICIODATĂ chatul complet mut.
  if (!answer) answer = await runClaudeBare(full, 60_000)
  return answer
}

// Comanda cea mai simplă cu putință — plasa de siguranță. Fără output-format,
// fără unelte, fără model: doar text din stdin. Dacă și asta tace, chiar nu se
// poate (CLI/abonament căzut), și abia atunci serverul dă mesajul cinstit.
function runClaudeBare(prompt, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(CLAUDE, ['-p'], { env: process.env })
    } catch {
      resolve(null)
      return
    }
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
    body: '{}',
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
    log(`Mesaj admin (${job.id.slice(0, 8)}) — model ${brainModel()}...`)
    const t0 = Date.now()
    let firstAt = 0
    // BUCĂȚILE difuzate se strâng într-un tampon și se trimit la ~150ms (coalesced)
    // ca să nu inundăm puntea cu zeci de POST-uri, dar textul tot curge live.
    let pending = ''
    const flush = () => {
      if (!pending) return
      const text = pending
      pending = ''
      void fetch(`${BASE}/api/bridge/reply-chunk`, {
        method: 'POST',
        headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, text }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {})
    }
    const onChunk = (t) => {
      if (!firstAt) firstAt = Date.now()
      pending += t
    }
    // La 150ms: dacă a curs text, trimite-l; altfel PULS DE VIAȚĂ (creierul
    // gândește) — ține tura vie cât timp Claude chiar lucrează (răspunsurile de
    // 30–80s mureau altfel). Ambele merg pe reply-chunk.
    let sinceBeat = 0
    const pulse = setInterval(() => {
      if (pending) {
        flush()
        sinceBeat = 0
      } else if ((sinceBeat += 150) >= 9000) {
        sinceBeat = 0
        void fetch(`${BASE}/api/bridge/reply-chunk`, {
          method: 'POST',
          headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: job.id, keepalive: true }),
          signal: AbortSignal.timeout(15_000),
        }).catch(() => {})
      }
    }, 150)
    let answer
    try {
      // Atașează pozele/fișierele jobului (dacă există) la prompt. Doar când
      // există fișiere permitem Read (ca să le privească); altfel chat pur, fără
      // unelte → instant.
      const fileNote = saveJobFiles(job)
      // job.prompt = context COMPLET (amorsare sesiune / fallback); job.turn =
      // pachetul SUBȚIRE (doar mesajul nou) pentru turele pe sesiunea caldă.
      answer = await askClaude(job.prompt + fileNote, onChunk, fileNote !== '', job.turn)
    } finally {
      clearInterval(pulse)
      flush() // orice bucată rămasă în tampon pleacă acum
    }
    if (answer) {
      await sendReply(job.id, answer)
      const totalMs = Date.now() - t0
      const firstMs = firstAt ? firstAt - t0 : 0
      log(`Raspuns trimis (${answer.length} car, ${totalMs}ms, primul cuvant ${firstMs || '—'}ms).`)
    } else {
      await sendReply(job.id, '')
      log('Fara raspuns — Kelion foloseste creierul normal pentru acest mesaj.')
    }
  } catch (e) {
    log(`Eroare: ${e.message} — reincerc in 10s`)
    await new Promise((r) => setTimeout(r, 10_000))
  }
}
