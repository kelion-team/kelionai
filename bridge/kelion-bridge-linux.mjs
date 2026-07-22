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
  let ctx = ''
  try {
    ctx = readFileSync('/root/kelion/context.md', 'utf8')
  } catch {}
  // ORDINUL LUI ADRIAN (11 iul: „să ajungă identic cu tine"): Kelion primește
  // ACEEAȘI sursă de adevăr din care lucrează Claude-din-cloud — AI-HANDOFF.md,
  // ținut la zi la fiecare schimbare și sincronizat pe VPS de bridge-deploy.
  // Se încarcă la amorsarea sesiunii calde (o dată la 8 ture), nu la fiecare
  // mesaj — cunoaștere completă cu cost mic. DOAR pe calea adminului (funcția
  // asta nu e chemată pe joburi publice — nimic privat nu curge la vizitatori).
  let handoff = ''
  try {
    handoff = readFileSync('/root/kelion/repo/AI-HANDOFF.md', 'utf8').slice(0, 120_000)
  } catch {}
  if (!handoff) return ctx
  return (
    ctx +
    '\n\n=== AI-HANDOFF.md — SURSA DE ADEVĂR COMUNĂ (aceeași din care lucrează Claude; ține cont de ea ca de propriile reguli) ===\n' +
    handoff
  )
}

// CREIERUL — Kimi (primar) → GLM (rezervă). Anthropic/Max scos complet (Adrian,
// 12 iul: „renunț la Anthropic, rămâne Kimi și GLM"). Numele efectiv al modelului
// îl impune treapta (tierModel); astea rămân doar ca implicit ne-Anthropic.
// CREIERUL = Kimi 2.7 (Adrian, 13 iul: „vreau Kimi 2.7"). Id-ul API al modelului
// K2 Thinking = `kimi-k2-thinking` (verificat live că endpointul îl acceptă, 200).
// Chatul/vocea folosesc varianta THINKING-TURBO (același creier K2 Thinking, servire
// mai rapidă — păstrează ținta de latență <1s); munca grea (constructorul) folosește
// `kimi-k2-thinking` plin. GLM rămâne rezerva.
const MODEL = 'kimi-k2-thinking-turbo'
const RESERVE = 'glm-5.2' // TOPUL GLM (Adrian 14 iul: adminul cere mereu cel mai performant; verificat live 200)
const REST_MS = 10 * 60_000
let fableDownUntil = 0
const brainModel = () => (Date.now() < fableDownUntil ? RESERVE : MODEL)

// ── LANȚUL DE ABONAMENTE (Adrian, 12 iul: „renunț la Anthropic"): Kimi → GLM ──
// ANTHROPIC/MAX SCOS COMPLET. Când cheia Kimi for Coding se golește („usage
// limit"), worker-ul comută AUTOMAT pe GLM Coding Plan și revine singur pe Kimi
// după pauza de răcire (Kimi se reîncearcă primul la fiecare spawn).
// Cheile stau pe VPS ca fișiere (puse de Adrian prin vps-keys.yml) — fără
// fișier-cheie, treapta e sărită, deci codul e complet inert până există chei.
// Endpoint-urile sunt compatibile Anthropic: același CLI, doar env schimbat.
// Kimi: model FIX `kimi-for-coding` (docs kimi.com/code — planul servește
// automat cel mai nou K2). GLM: numele claude e mapat de endpoint-ul lor.
// Valorile Kimi sunt din docs-ul lor oficial pentru Claude Code (kimi.com/code/
// docs → third-party tools): ANTHROPIC_BASE_URL=https://api.kimi.com/coding/ +
// ANTHROPIC_API_KEY + fereastra de context 262144. Punem și AUTH_TOKEN (GLM îl
// folosește pe ăla) — e inofensiv să fie ambele setate.
// ANTHROPIC/MAX SCOS COMPLET (Adrian, 12 iul): treapta `max` (abonamentul Claude)
// a fost eliminată. Lanțul e Kimi (primar) → GLM (rezervă); fără cheie, chatul
// eșuează cinstit (fără auth), NU cade pe Anthropic.
const TIERS = [
  {
    name: 'kimi',
    keyFile: '/root/kelion/kimi-key.txt',
    base: 'https://api.kimi.com/coding/',
    // CHAT/VOCE → Kimi 2.7 (K2 Thinking), varianta turbo pentru latență. Constructorul
    // (munca grea) folosește `kimi-k2-thinking` plin, în kelion-builder-server.mjs.
    model: 'kimi-k2-thinking-turbo',
    extraEnv: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144' },
  },
  // GLM cere modelul lui NATIV — `model: null` cădea pe modelul claude cerut
  // (claude-fable-5), respins de z.ai cu „400 Unknown Model" (12 iul). `glm-4.6`
  // e fallback-ul sigur; failover-ul pe GLM la chat e rar (cere Max+Kimi golite).
  { name: 'glm', keyFile: '/root/kelion/glm-key.txt', base: 'https://api.z.ai/api/anthropic', model: 'glm-5.2' },
]
const TIER_COOLDOWN_MS = 5 * 60_000 // Adrian, 13 iul: „5 minute automat" (era 30)
const TIER_COOLDOWN_MAX_MS = 5 * 60_000 // FIX 5 min (fără backoff crescător) — Kimi revine automat rapid
const tierDownUntil = Object.create(null)
// PERSISTENȚA STĂRII TREPTELOR (Adrian, 12 iul: „să nu mai revină la următorul
// deploy"). tierDownUntil era DOAR în memorie → la fiecare restart/deploy chatul
// pornea iar pe Max epuizat și reflappa (max→kimi la fiecare mesaj). O salvăm pe
// disc și o reîncărcăm la boot: o treaptă golită RĂMÂNE golită peste deploy,
// până-i expiră răcirea. `fails` = câte cote la rând (pentru backoff).
const TIER_STATE_FILE = '/root/kelion/tier-state.json'
const tierFails = Object.create(null)
function persistTierState() {
  try {
    writeFileSync(TIER_STATE_FILE, JSON.stringify({ downUntil: tierDownUntil, fails: tierFails }))
  } catch {
    /* disc plin/readonly — nu blocăm chatul pentru persistență */
  }
}
function loadTierState() {
  try {
    const s = JSON.parse(readFileSync(TIER_STATE_FILE, 'utf8'))
    const now = Date.now()
    for (const [name, until] of Object.entries(s.downUntil ?? {})) {
      if (typeof until === 'number' && until > now) tierDownUntil[name] = until
    }
    for (const [name, n] of Object.entries(s.fails ?? {})) {
      if (typeof n === 'number' && n > 0) tierFails[name] = n
    }
  } catch {
    /* prima pornire / fișier lipsă — pornim curat */
  }
}
loadTierState()
function tierKeyOf(t) {
  if (!t.keyFile) return null
  try {
    return readFileSync(t.keyFile, 'utf8').trim() || null
  } catch {
    return null
  }
}
// SISTEM DE URMĂRIRE A TREPTELOR (Adrian, 12 iul: „sistem de urmărit când sunt
// repuse valorile noi, interogare când se alocă prin cheie, revenire la
// ordinea prestabilită automat"). Fiecare tranziție reală (nu doar fiecare
// verificare — currentTier() e chemată des) pleacă spre server, o singură
// dată per schimbare: `action` e „switch" când treapta nouă e mai jos în
// ordinea preferată (cotă golită) sau „revert" când e mai sus (revenire
// automată după cooldown — exact „ordinea prestabilită").
let lastReportedTier = null
function reportTierChange(from, to, reason) {
  const fromIdx = from ? TIERS.findIndex((t) => t.name === from) : -1
  const toIdx = TIERS.findIndex((t) => t.name === to)
  const action = fromIdx === -1 ? 'boot' : toIdx < fromIdx ? 'revert' : 'switch'
  fetch(`${BASE}/api/bridge/tier-event`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker: 'chat', from, to, action, reason }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}
function currentTier() {
  let picked = TIERS[0] // toate golite → tot Kimi (primarul; Anthropic/Max scos)
  for (const t of TIERS) {
    if ((tierDownUntil[t.name] ?? 0) > Date.now()) continue
    if (t.keyFile && !tierKeyOf(t)) continue
    picked = t
    break
  }
  if (picked.name !== lastReportedTier) {
    const from = lastReportedTier
    lastReportedTier = picked.name
    reportTierChange(from, picked.name, lastQuotaReason)
  }
  return picked
}
// Semnăturile de cotă golită. Se verifică DOAR pe canalele de EROARE (stderr,
// result cu is_error) — NICIODATĂ pe textul răspunsului normal, altfel o simplă
// discuție despre limite ar comuta treapta din greșeală.
const QUOTA_RE = /usage limit|usage credits|credit balance|rate.?limit|quota|429/i
// SEMNĂTURA MESAJULUI DE EROARE AL CLI-ULUI, ca RĂSPUNS (nu doar pe stderr).
// Când abonamentul e golit, `claude -p` scrie EXACT „You're out of usage
// credits. /model to switch models." la STDOUT, ca și cum ar fi replica lui
// Kelion — și ajungea la Adrian ca răspuns (bug 12 iul). Astea sunt șiruri
// emise de CLI, nu ceva ce ar spune Kelion natural, deci le prindem sigur.
const CLI_ERR_RE =
  /you'?re out of usage credits|out of usage credits|\/model to switch models|credit balance is too low|please run \/login|invalid api key|authentication_error|401 unauthorized/i
function isCliError(text) {
  return CLI_ERR_RE.test(String(text ?? ''))
}
let lastQuotaReason = null
function quotaHit(tierName, errText) {
  if (!errText || !QUOTA_RE.test(String(errText))) return false
  // BACKOFF (Adrian, 12 iul: „fără întrerupere, fără flapp"): o treaptă cronic
  // golită (ex. Max) nu se mai reîncearcă la fiecare 30 min (ceea ce o făcea să
  // reflappe max→kimi→max), ci la intervale tot mai mari: 30m → 1h → 2h... 6h.
  tierFails[tierName] = (tierFails[tierName] || 0) + 1
  const cooldown = Math.min(TIER_COOLDOWN_MS * 2 ** (tierFails[tierName] - 1), TIER_COOLDOWN_MAX_MS)
  tierDownUntil[tierName] = Date.now() + cooldown
  lastQuotaReason = String(errText).slice(0, 300)
  persistTierState()
  log(`[abonament] treapta „${tierName}" golită (a ${tierFails[tierName]}-a oară) — comut, revin în ${Math.round(cooldown / 60_000)} min.`)
  return true
}
// O treaptă a răspuns cu text REAL → resetează contorul de eșecuri (backoff-ul
// pleacă de la zero data viitoare). Așa Max, când chiar revine, e reîncercat
// prompt, nu ținut degeaba la răcire lungă.
function noteTierOk(tierName) {
  if (tierFails[tierName]) {
    tierFails[tierName] = 0
    persistTierState()
  }
}

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
  // CAMERA = DOAR LA CREIER, niciodată narată (ordin Adrian, 13 iul: „ce vede
  // merge la creier doar, nu iese în chat"). Cadrele sunt CONTEXT INTERN TĂCUT:
  // creierul le citește în liniște, NU narează că se uită, NU scrie „Văd
  // cadrele" sau „[READ] cale". Vorbește despre ce vede DOAR dacă (a) mesajul
  // cere explicit vederea, ori (b) detectează o ALERTĂ reală (pericol/urgență)
  // în cadre — atunci o anunță scurt. Altfel, cadrele rămân fundal tăcut.
  const rule = isPublic
    ? `\n\nCAMERA CONTEXT (silent — your eyes only): the frames below are the visitor's live camera. Read them SILENTLY with your Read tool to understand the scene, but NEVER narrate that you are looking, NEVER write "I see the frames", "looking at the frames", or "[READ] <path>". Answer the visitor's actual message. Mention what you see ONLY IF their message explicitly asks about it, OR IF you detect a genuine ALERT (danger, fall, emergency) in the frames — then state it briefly. Otherwise treat the frames as silent background and do not mention them.\nFRAMES:\n${paths.map((p) => `- ${p}`).join('\n')}\n`
    : `\n\nCONTEXT CAMERĂ/FIȘIERE (TĂCUT — doar pentru tine): cadrele/fișierele de mai jos sunt context intern. Citește-le ÎN LINIȘTE cu unealta Read ca să înțelegi scena — dar NICIODATĂ nu narra că te uiți, NU scrie „Văd cadrele", „mă uit la cadre" sau „[READ] cale". Răspunde la MESAJUL lui Adrian. Vorbește despre ce vezi DOAR dacă (a) mesajul lui cere explicit să te uiți/citești, ori (b) detectezi o ALERTĂ reală (pericol, cădere, urgență) în cadre — atunci anunț-o scurt. Altfel, tratează cadrele ca fundal tăcut și NU le pomeni.\nCADRE/FIȘIERE:\n${paths.map((p) => `- ${p}`).join('\n')}\n`
  return rule
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
function claudeArgs({ streaming, model, hasFiles, pub, tools, addDir }) {
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
  // WORK LOOP: unelte complete (Read, Bash, Edit, Write) pentru construcție cod
  if (tools?.length) {
    args.push('--allowedTools', ...tools)
    if (addDir) args.push('--add-dir', addDir)
  }
  if (model) args.push('--model', model)
  return args
}

// cwd NEUTRU pentru joburile PUBLICE: `claude -p` își încarcă automat CLAUDE.md
// și contextul din directorul curent — un job de vizitator pornit din
// /root/kelion ar primi pe furiș contextul privat. Public → rulează din /tmp.
// Env-ul vine de la TREAPTA de abonament activă: pe „max" e mediul de azi,
// neschimbat; pe rezerve se adaugă baza + cheia (compatibil Anthropic).
function tierSpawnEnv(tier) {
  const key = tierKeyOf(tier)
  // ANTHROPIC/MAX SCOS (Adrian, 12 iul): în ORICE caz scoatem tokenul de abonament
  // din env, ca CLI-ul să nu poată autentifica pe Anthropic. Fără cheie Kimi/GLM,
  // spawn-ul eșuează cinstit (fără auth) — NICIODATĂ pe Max.
  const env = { ...process.env }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  if (!key) return env
  return {
    ...env,
    ...(tier.extraEnv ?? {}),
    ANTHROPIC_BASE_URL: tier.base,
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_AUTH_TOKEN: key,
  }
}
const spawnOpts = (pub, tier = currentTier()) =>
  pub ? { env: tierSpawnEnv(tier), cwd: '/tmp' } : { env: tierSpawnEnv(tier) }
// Modelul efectiv al unei trepte: rezervele își impun modelul lor (ex. Kimi
// cere fix `kimi-for-coding`); pe „max" rămâne modelul cerut (Fable/Opus).
const tierModel = (tier, model) => (tier.model !== undefined && tier.model !== null ? tier.model : model)

// ── PROCESE DE GARDĂ PUBLICE (#7 latență, Adrian 10 iul) ─────────────────────
// Jobul public rulează într-un proces `claude` PROASPĂT (izolare: un proces = UN
// vizitator = O tură; între vizitatori nu se scurge nimic). Pornirea procesului
// costa însă 1–4s la FIECARE mesaj. Aici ținem 2 procese DEJA PORNITE care
// așteaptă pe stdin: jobul public ia unul gata încălzit (plătește doar gândirea
// modelului, nu boot-ul), iar în loc se naște imediat alt standby. Izolarea
// rămâne identică — procesul e folosit O dată și moare.
const pubStandby = [] // { child, model, born, dead }
const STANDBY_TARGET = 2 // cât PUBLIC_MAX — un val de 2 vizitatori pornește cald
const STANDBY_MAX_AGE = 10 * 60_000 // reciclare: un proces stătut se aruncă

function spawnStandby() {
  const tier = currentTier()
  const model = tierModel(tier, brainModel())
  let child
  try {
    child = spawn(CLAUDE, claudeArgs({ streaming: true, model, hasFiles: false, pub: true }), spawnOpts(true, tier))
  } catch {
    return null
  }
  const entry = { child, model, tier: tier.name, born: Date.now(), dead: false }
  child.on('error', () => {
    entry.dead = true
  })
  child.on('close', () => {
    entry.dead = true
    const i = pubStandby.indexOf(entry)
    if (i !== -1) pubStandby.splice(i, 1)
  })
  return entry
}
function fillStandby() {
  while (pubStandby.length < STANDBY_TARGET) {
    const e = spawnStandby()
    if (!e) break
    pubStandby.push(e)
  }
}
// Ia un proces cald potrivit (modelul curent, nu prea bătrân); nepotrivitele se
// aruncă. Locul golit se umple imediat pentru vizitatorul următor.
function takeStandby() {
  while (pubStandby.length) {
    const e = pubStandby.shift()
    if (e.dead) continue
    const t = currentTier()
    if (e.model !== tierModel(t, brainModel()) || e.tier !== t.name || Date.now() - e.born > STANDBY_MAX_AGE) {
      try {
        e.child.kill()
      } catch {}
      continue
    }
    setTimeout(fillStandby, 10)
    return e
  }
  setTimeout(fillStandby, 10)
  return null
}
// Reciclare periodică: standby-urile îmbătrânite mor și se nasc altele — mereu
// procese tinere, pe modelul curent.
setInterval(() => {
  const t = currentTier()
  for (const e of [...pubStandby]) {
    if (e.dead || e.model !== tierModel(t, brainModel()) || e.tier !== t.name || Date.now() - e.born > STANDBY_MAX_AGE) {
      try {
        e.child.kill()
      } catch {}
      const i = pubStandby.indexOf(e)
      if (i !== -1) pubStandby.splice(i, 1)
    }
  }
  fillStandby()
}, 60_000)
fillStandby() // de la pornire: primul vizitator prinde deja un proces cald

// ── SESIUNEA CALDĂ (chatul adminului) ───────────────────────────────────────
// UN proces `claude` viu, în modul conversație (stream-json pe stdin): prima
// tură îl amorsează cu contextul complet (context.md + preambul + pachetul
// serverului), turele următoare trimit DOAR job.turn — fără pornire la rece,
// fără context retrimis. Dacă CLI-ul de pe VPS nu ține procesul viu după prima
// tură, sesiunea „moare" curat și tura următoare amorsează una nouă — adică
// exact comportamentul de azi, niciodată mai rău.
// RECICLARE DES (Adrian, 10 iul: „chatul se degradează") — 30 → 8. Sesiunea
// caldă acumula conversația peste ture și încetinea/dilua treptat răspunsurile;
// reciclată la 8 ture, contextul rămâne mic și viteza CONSTANTĂ (fără degradare
// lentă). A 8-a tură reprimează o dată (cost mic, o singură dată), restul zboară.
const WARM_MAX_TURNS = 8
let warm = null

// O sesiune caldă e „stătută" și când s-a schimbat treapta de abonament sau
// modelul ei — se taie și se amorsează una nouă pe treapta/modelul curent.
function staleWarm(s) {
  const t = currentTier()
  return !s.alive || s.turns >= WARM_MAX_TURNS || s.tier !== t.name || s.model !== tierModel(t, brainModel())
}

function startWarm(model, pub = false) {
  const tier = currentTier()
  const effModel = tierModel(tier, model)
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]
  if (effModel) args.push('--model', effModel)
  let child
  try {
    // pub=true → cwd /tmp (fără CLAUDE.md/contextul privat) — aceeași izolare
    // ca procesele proaspete publice, dar cu sesiune vie per vizitator.
    child = spawn(CLAUDE, args, spawnOpts(pub, tier))
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
    model: effModel,
    tier: tier.name,
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
        if (ev.is_error) {
          // Cotă golită / eroare CLI pe CALEA PRIMARĂ (sesiunea caldă a
          // adminului). BUG 12 iul: textul erorii („out of usage credits") era
          // pus ca `final` și întors ca RĂSPUNS — de-aia Adrian îl vedea deși
          // celelalte 3 producătoare erau deja reparate. Acum: marchează treapta,
          // OMOARĂ sesiunea (e pe treapta moartă) și încheie GOL → askWarm
          // întoarce null → cascada askClaude pornește pe treapta următoare.
          quotaHit(tier.name, typeof ev.result === 'string' ? ev.result : '')
          return s.kill()
        }
        const final = typeof ev.result === 'string' ? ev.result.trim() : ''
        const full = final.length >= turn.streamed.trim().length ? final : turn.streamed.trim()
        // Plasă: dacă „răspunsul" e chiar mesajul de eroare al CLI-ului (scăpat
        // pe stdout, nu marcat is_error), tratează-l identic.
        if (full && isCliError(full)) {
          quotaHit(tier.name, full)
          return s.kill()
        }
        // Coada nedifuzată (finalul e mai lung decât ce-a curs) pleacă și ea.
        if (full && full.length > turn.streamed.length && full.startsWith(turn.streamed)) {
          turn.onChunk?.(full.slice(turn.streamed.length))
        }
        if (full) noteTierOk(tier.name) // treapta a răspuns real → resetează backoff-ul
        endTurn(full || null)
      }
    }
  })
  let warmErr = ''
  child.stderr.on('data', (d) => {
    warmErr += d
  })
  child.on('close', () => {
    s.alive = false
    quotaHit(tier.name, warmErr)
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
  if (warm && staleWarm(warm)) {
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

// ── SESIUNI CALDE PER-VIZITATOR (#7 latență, 11 iul) ─────────────────────────
// Fiecare vizitator (cheia = job.visitor, emailul sesiunii lui) are PROPRIA
// sesiune caldă, complet izolată de a adminului și de ale celorlalți vizitatori
// (un vizitator nu vede NICIODATĂ sesiunea altuia — cheia e a lui). Prima tură
// amorsează cu personajul public + conversația; turele 2+ trimit doar pachetul
// subțire → primul cuvânt ca la admin, sub secundă când modelul curge.
const warmPub = new Map() // visitor -> sesiune caldă
const WARM_PUB_MAX = 6 // plafon RAM pe VPS; peste → LRU afară
const WARM_PUB_IDLE_MS = 10 * 60_000 // vizitator plecat → sesiunea se stinge

function askWarmPub(job, onChunk, cancel) {
  if (!job.turn || !job.visitor) return Promise.resolve(null)
  let s = warmPub.get(job.visitor)
  if (s && staleWarm(s)) {
    s.kill()
    warmPub.delete(job.visitor)
    s = null
  }
  let text
  if (!s) {
    // Plafon: sesiunea cea mai demult folosită iese (LRU).
    if (warmPub.size >= WARM_PUB_MAX) {
      let oldK = null
      let oldT = Infinity
      for (const [k, v] of warmPub) {
        if ((v.lastUsed ?? 0) < oldT) {
          oldT = v.lastUsed ?? 0
          oldK = k
        }
      }
      if (oldK) {
        warmPub.get(oldK)?.kill()
        warmPub.delete(oldK)
      }
    }
    s = startWarm(brainModel(), true)
    if (!s) return Promise.resolve(null)
    warmPub.set(job.visitor, s)
    log(`Sesiune caldă publică nouă (${job.visitor.slice(0, 12)}…, model ${s.model}).`)
    text = PUBLIC_PREAMBLE + job.prompt
  } else {
    text = job.turn
  }
  s.lastUsed = Date.now()
  const sess = s
  const key = job.visitor
  cancel?.attach({
    kill: () => {
      sess.kill()
      if (warmPub.get(key) === sess) warmPub.delete(key)
    },
  })
  return sess.ask(text, onChunk)
}
// Mătură sesiunile publice părăsite — vizitatorul plecat nu ține procese vii.
setInterval(() => {
  for (const [k, v] of warmPub) {
    if (!v.alive || Date.now() - (v.lastUsed ?? 0) > WARM_PUB_IDLE_MS) {
      try {
        v.kill()
      } catch {}
      warmPub.delete(k)
    }
  }
}, 60_000)

function runClaudeStream(prompt, { timeoutMs, model, onChunk, hasFiles, pub, cancel, warmChild, tools, addDir } = {}) {
  return new Promise((resolve) => {
    // Treapta de abonament curentă (standby-ul luat e garantat pe aceeași
    // treaptă — takeStandby aruncă nepotrivitele).
    const tier = currentTier()
    // Proces de gardă deja pornit (public) → sare peste boot; altfel spawn clasic.
    const child =
      warmChild ??
      spawn(CLAUDE, claudeArgs({ streaming: true, model: tierModel(tier, model), hasFiles, pub, tools, addDir }), spawnOpts(pub, tier))
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
          if (ev.is_error) {
            // Cotă golită / eroare CLI → marchează treapta jos, dar NU păstra
            // textul erorii ca răspuns (bug 12 iul: „out of usage credits"
            // ajungea la Adrian ca replica lui Kelion). Îl lăsăm gol → cascada
            // askClaude trece TĂCUT pe treapta următoare (kimi/glm).
            quotaHit(tier.name, ev.result)
          } else if (ev.result.trim().length > finalText.trim().length) {
            // Răspunsul final complet (autoritar). Îl păstrăm pe cel mai lung.
            finalText = ev.result
          }
        }
      }
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => {
      clearTimeout(killer)
      const full = (finalText.trim().length >= streamed.trim().length ? finalText : streamed).trim()
      // Plasă: dacă răspunsul E de fapt mesajul de eroare al CLI-ului (cotă
      // golită scăpată pe stdout, nu pe is_error), marchează treapta și întoarce
      // GOL — nu-l arăta ca replică, nu difuza coada. Cascada trece pe următoarea.
      if (full && isCliError(full)) {
        quotaHit(tier.name, full)
        return resolve(null)
      }
      // Dacă finalul e mai lung decât ce-am difuzat (și e o continuare curată),
      // trimite coada lipsă ca ultimă bucată — să nu piardă Adrian sfârșitul.
      if (full && full.length > streamed.length && full.startsWith(streamed)) {
        const tail = full.slice(streamed.length)
        if (tail) onChunk?.(tail)
      }
      if (!full && err.trim()) {
        log(`claude stderr: ${err.trim().slice(0, 200)}`)
        // Treapta golită se marchează → următorul spawn (inclusiv fallback-ul
        // text din cascada askClaude, în ACEEAȘI tură) pornește pe următoarea.
        quotaHit(tier.name, err)
      }
      if (full) noteTierOk(tier.name) // treapta a răspuns real → resetează backoff-ul
      resolve(full || null)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// PLASĂ DE SIGURANȚĂ: modul text vechi (dovedit), fără streaming. Folosit doar
// dacă streamingul nu scoate nimic (versiune de CLI fără `stream-json`) — așa
// nu coborâm NICIODATĂ sub comportamentul de azi.
function runClaudeText(prompt, { timeoutMs, model, hasFiles, pub, cancel, tools, addDir } = {}) {
  return new Promise((resolve) => {
    const tier = currentTier()
    const args = claudeArgs({ streaming: false, model: tierModel(tier, model), hasFiles, pub, tools, addDir })
    const child = spawn(CLAUDE, args, spawnOpts(pub, tier))
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
      const text = out.trim()
      // CLI a scris eroarea de cotă la stdout ca „răspuns" → marchează treapta,
      // întoarce GOL (nu ajunge la user), cascada trece pe următoarea.
      if (text && isCliError(text)) {
        quotaHit(tier.name, text)
        return resolve(null)
      }
      if (text) {
        noteTierOk(tier.name) // răspuns real → resetează backoff-ul treptei
        return resolve(text)
      }
      if (err.trim()) {
        log(`claude stderr: ${err.trim().slice(0, 200)}`)
        quotaHit(tier.name, err)
      }
      resolve(null)
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
  // ADMIN = unelte complete (Read, Bash, Edit, Write) ca să poată executa ordine.
  // Public = fără unelte (izolare + viteză).
  const ADMIN_TOOLS = isPublic ? undefined : ['Read', 'Bash', 'Edit', 'Write']
  const ADMIN_DIR = isPublic ? undefined : '/root/kelion/repo'
  // Buget de timp MĂRGINIT (Adrian, 10 iul + audit): serverul renunță la 75s și
  // maxTries=1, deci n-are rost să măcinăm minute pe un job pe care serverul
  // deja l-a uitat. Chatul fără unelte răspunde în ~2s, deci pragurile astea nu
  // se ating decât la rațiune grea; cascada e scurtă, nu 4×120s ca înainte.
  // Public fără fișiere → proces de gardă (boot-ul deja făcut → primul cuvânt
  // mult mai devreme). Modelul standby-ului e garantat cel curent (takeStandby).
  const standby = isPublic && !hasFiles ? takeStandby() : null
  let answer = await runClaudeStream(full, {
    timeoutMs: 90_000,
    model,
    onChunk,
    hasFiles,
    pub: isPublic,
    cancel,
    warmChild: standby?.child,
    tools: ADMIN_TOOLS,
    addDir: ADMIN_DIR,
  })
  if (cancel?.cancelled) return answer
  if (!answer) answer = await runClaudeText(full, { timeoutMs: 45_000, model, hasFiles, pub: isPublic, cancel, tools: ADMIN_TOOLS, addDir: ADMIN_DIR })
  if (cancel?.cancelled) return answer
  if (!answer && model === MODEL) {
    fableDownUntil = Date.now() + REST_MS
    log('Fable a esuat — trec pe Opus, revin la Fable in 10 min.')
    answer = await runClaudeStream(full, { timeoutMs: 90_000, model: RESERVE, onChunk, hasFiles, pub: isPublic, cancel, tools: ADMIN_TOOLS, addDir: ADMIN_DIR })
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

// LUCRU/rapoarte/agenți: promptul vine deja construit de server; nu adăugăm
// PREAMBLE conversațional și nu folosim SESIUNEA CALDĂ a chatului. Rulează pe
// canale separate, deci un raport greu NU poate ține mesajul următor al lui
// Adrian la coadă.
async function askWorkClaude(prompt, onChunk, cancel) {
  const model = brainModel()
  // WORK LOOP: unelte complete pentru construcție cod — Read, Bash, Edit, Write
  const WORK_TOOLS = ['Read', 'Bash', 'Edit', 'Write']
  const WORK_DIR = '/root/kelion/repo'
  let answer = await runClaudeStream(prompt, {
    timeoutMs: 120_000,
    model,
    onChunk,
    hasFiles: false,
    pub: false,
    cancel,
    tools: WORK_TOOLS,
    addDir: WORK_DIR,
  })
  if (cancel?.cancelled) return answer
  if (!answer) answer = await runClaudeText(prompt, { timeoutMs: 60_000, model, hasFiles: false, pub: false, cancel, tools: WORK_TOOLS, addDir: WORK_DIR })
  if (cancel?.cancelled) return answer
  if (!answer && model === MODEL) {
    fableDownUntil = Date.now() + REST_MS
    log('Fable a esuat pe lucru — trec pe Opus, revin la Fable in 10 min.')
    answer = await runClaudeStream(prompt, {
      timeoutMs: 120_000,
      model: RESERVE,
      onChunk,
      hasFiles: false,
      pub: false,
      cancel,
      tools: WORK_TOOLS,
      addDir: WORK_DIR,
    })
  }
  if (cancel?.cancelled) return answer
  if (!answer) answer = await runClaudeBare(prompt, 60_000, false, cancel)
  return answer
}

// Comanda cea mai simplă cu putință — plasa de siguranță. Fără output-format,
// fără unelte, fără model: doar text din stdin. Dacă și asta tace, chiar nu se
// poate (CLI/abonament căzut), și abia atunci serverul dă mesajul cinstit.
function runClaudeBare(prompt, timeoutMs = 60_000, pub = false, cancel) {
  return new Promise((resolve) => {
    let child
    const tier = currentTier()
    try {
      child = spawn(CLAUDE, ['-p'], spawnOpts(pub, tier))
    } catch {
      resolve(null)
      return
    }
    cancel?.attach(child)
    let out = ''
    // Întoarce răspunsul, dar dacă e mesajul de eroare al CLI-ului (cotă golită),
    // marchează treapta și întoarce GOL — nu-l arăta ca replică.
    const finish = () => {
      const text = out.trim()
      if (text && isCliError(text)) {
        quotaHit(tier.name, text)
        return resolve(null)
      }
      if (text) noteTierOk(tier.name)
      resolve(text || null)
    }
    const killer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish()
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => {
      clearTimeout(killer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(killer)
      finish()
    })
    try {
      child.stdin.write(prompt)
      child.stdin.end()
    } catch {
      /* ignore */
    }
  })
}

// LIVENESS pentru watchdog: momentul ultimei ATINGERI reușite a backendului
// (orice răspuns HTTP de la /api/bridge/pull = puntea e vie și conectată).
let lastReach = Date.now()

async function pull(lane = 'chat') {
  // Timeout obligatoriu: fără el, un sughiț de rețea lăsa fetch-ul agățat pe
  // veci și bucla murea „vie" — puntea părea căzută (4 iul). Long-poll = 25s.
  const res = await fetch(`${BASE}/api/bridge/pull`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    // Declaram CAPABILITATEA persona: serverul da joburi PUBLICE doar workerilor
    // care o declara — zombii/vechii (body gol) nu mai pot primi vizitatori.
    body: JSON.stringify({ caps: ['persona'], lane }),
    signal: AbortSignal.timeout(40_000),
  })
  lastReach = Date.now() // am atins backendul (chiar și un 4xx/5xx = conexiune vie)
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

// Un job CHAT/VOCE, cap-coadă: streaming spre punte + puls de viață + anulare la abandon.
// Folosește SESIUNILE CALDE dedicate chatului (admin sau per-vizitator).
async function handleChatJob(job) {
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
  // ORDINEA BUCĂȚILOR (bug „degradare continuă", 12 iul): `void post` lăsa două
  // POST-uri în zbor simultan; când al doilea sosea la backend înaintea primului
  // (jitter/încărcare — tot mai des în sesiuni lungi), backend-ul le lipea în
  // ordinea SOSIRII → textul lui Kelion ieșea amestecat („B acum?ună dimineața").
  // Le înlănțuim: fiecare POST pleacă DOAR după ce precedentul s-a întors, deci
  // sosesc garantat în ordine. `pending` se acumulează cât un POST e în zbor →
  // se grupează singur, rămâne rapid, primul cuvânt pleacă tot instant.
  let postChain = Promise.resolve()
  const flush = () => {
    if (!pending) return
    const text = pending
    pending = ''
    postChain = postChain.then(() => post({ id: job.id, text })).catch(() => {})
  }
  const onChunk = (t) => {
    const isFirst = !firstAt
    if (!firstAt) firstAt = Date.now()
    pending += t
    // PRIMA bucată pleacă INSTANT (#7 latență): nu mai stă până la 150ms în
    // tampon — primul cuvânt al utilizatorului nu are voie să aștepte ceasul.
    if (isFirst) flush()
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
    // PUBLIC fără fișiere → sesiunea caldă A VIZITATORULUI (izolată per cheie).
    // Cu fișiere (are nevoie de Read) → proces proaspăt.
    if (!isPubJob && !fileNote) answer = await askWarm(job, onChunk, cancel)
    if (isPubJob && !fileNote) answer = await askWarmPub(job, onChunk, cancel)
    if (!answer && !cancel.cancelled) {
      answer = await askClaude(job.prompt + fileNote, onChunk, fileNote !== '', isPubJob, cancel)
    }
  } finally {
    clearInterval(pulse)
    flush() // orice bucată rămasă în tampon pleacă acum
    // AȘTEAPTĂ golirea lanțului de bucăți ÎNAINTE de sendReply. Fără asta, /reply
    // ajungea la backend înaintea ULTIMEI bucăți (înlănțuită de #158) → backend-ul
    // ștergea sink-ul → ultimele cuvinte se pierdeau din text, istoric ȘI voce
    // (regresie #158, 12 iul: replicile își pierdeau finalul). Acum coada se
    // golește prima, deci `streamed` de pe backend e complet.
    await postChain.catch(() => {})
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

// Un job de LUCRU (raport/veghe/caiet-alert/agent/ordin): prompt deja construit
// de server, fără PREAMBLE conversațional și FĂRĂ a folosi sesiunea caldă a
// chatului. Rulează pe canale separate, deci nu poate bloca vocea/chatul.
async function handleWorkJob(job) {
  log(`Lucru sistem (${job.id.slice(0, 8)}) — model ${brainModel()}...`)
  const t0 = Date.now()
  let firstAt = 0
  const cancel = makeCancel()
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
        if (j && j.gone) cancel.cancel()
      })
      .catch(() => {})
  // ORDINEA BUCĂȚILOR (bug „degradare continuă", 12 iul): `void post` lăsa două
  // POST-uri în zbor simultan; când al doilea sosea la backend înaintea primului
  // (jitter/încărcare — tot mai des în sesiuni lungi), backend-ul le lipea în
  // ordinea SOSIRII → textul lui Kelion ieșea amestecat („B acum?ună dimineața").
  // Le înlănțuim: fiecare POST pleacă DOAR după ce precedentul s-a întors, deci
  // sosesc garantat în ordine. `pending` se acumulează cât un POST e în zbor →
  // se grupează singur, rămâne rapid, primul cuvânt pleacă tot instant.
  let postChain = Promise.resolve()
  const flush = () => {
    if (!pending) return
    const text = pending
    pending = ''
    postChain = postChain.then(() => post({ id: job.id, text })).catch(() => {})
  }
  const onChunk = (t) => {
    if (!firstAt) firstAt = Date.now()
    pending += t
  }
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
    answer = await askWorkClaude(job.prompt, onChunk, cancel)
  } finally {
    clearInterval(pulse)
    flush()
    // Aceeași gardă ca pe calea de chat: golește lanțul de bucăți ÎNAINTE de
    // sendReply, ca ultima bucată (înlănțuită de #158) să nu se piardă când /reply
    // ajunge prima și șterge sink-ul.
    await postChain.catch(() => {})
  }
  if (cancel.cancelled) {
    await sendReply(job.id, '').catch(() => {})
    log(`Lucru ${job.id.slice(0, 8)} abandonat de server — banda de lucru eliberată.`)
    return
  }
  if (answer) {
    await sendReply(job.id, answer)
    const totalMs = Date.now() - t0
    const firstMs = firstAt ? firstAt - t0 : 0
    log(`Raspuns lucru trimis (${answer.length} car, ${totalMs}ms, primul cuvant ${firstMs || '—'}ms).`)
  } else {
    await sendReply(job.id, '')
    log('Fara raspuns la lucru — serverul isi raspunde singur.')
  }
}

// ── BENZI SEPARATE + CHAT LIVE ÎN PARALEL ───────────────────────────────────
// Adminul: banda lui, max 2 ÎN PARALEL (Adrian, 10 iul: „chatul trebuie live în
// paralel cât lucrează agenții"). Cât o tură lungă lucrează (raționament greu,
// agent), un MESAJ NOU nu mai stă la coadă: sesiunea caldă e ocupată de tura în
// curs, deci noul mesaj cade automat pe un proces `claude` proaspăt (askWarm
// întoarce null când sesiunea caldă are o tură în zbor) și primește răspuns pe
// loc. Publicul: banda lui separată, tot max 2, ca un val de vizitatori să nu-l
// pună pe Adrian la coadă.
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
// Banda adminului — aceeași mecanică de concurență (max 2), ca mesajul nou să
// fie servit cât o tură lungă încă rulează.
let adminActive = 0
const ADMIN_MAX = 2
const adminWaiters = []
async function acquireAdmin() {
  if (adminActive < ADMIN_MAX) {
    adminActive++
    return
  }
  await new Promise((r) => adminWaiters.push(r))
  adminActive++
}
function releaseAdmin() {
  adminActive--
  const w = adminWaiters.shift()
  if (w) w()
}
// Banda de LUCRU — separată de chat/voice: rapoarte, veghe, caiet-alert, agenți,
// ordine. Max 2 în paralel; indiferent câte joburi de lucru vin, ele NU pot lua
// niciodată canalele rezervate pentru chat (admin/public).
let workActive = 0
const WORK_MAX = 2
const workWaiters = []
async function acquireWork() {
  if (workActive < WORK_MAX) {
    workActive++
    return
  }
  await new Promise((r) => workWaiters.push(r))
  workActive++
}
function releaseWork() {
  workActive--
  const w = workWaiters.shift()
  if (w) w()
}

log(`Puntea non-stop PORNITA -> ${BASE} (model principal ${MODEL}, rezerva ${RESERVE})`)

// Buclă CHAT/VOCE: trage DOAR joburi lane='chat'. Sesiunea caldă admin + sesiuni
// calde per-vizitator aparțin exclusiv acestei bucle.
async function chatLoop() {
  for (;;) {
    try {
      const job = await pull('chat')
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
            await handleChatJob(job)
          } catch (e) {
            log(`Eroare pe tura publica ${job.id.slice(0, 8)}: ${e.message}`)
            await sendReply(job.id, '').catch(() => {})
          } finally {
            releasePublic()
          }
        })()
      } else {
        void (async () => {
          await acquireAdmin()
          try {
            await handleChatJob(job)
          } catch (e) {
            log(`Eroare pe tura admin ${job.id.slice(0, 8)}: ${e.message}`)
            await sendReply(job.id, '').catch(() => {})
          } finally {
            releaseAdmin()
          }
        })()
      }
    } catch (e) {
      // 3s, nu 10s (Adrian: „se blochează") — un sughiț de rețea nu mai lasă
      // puntea moartă zece secunde; long-poll-ul oricum absoarbe graba.
      log(`Eroare chat loop: ${e.message} — reincerc in 3s`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

// Buclă de LUCRU: trage DOAR joburi lane='work'. Fără sesiune caldă, fără
// preamble; canalele sunt separate de chat, deci un raport greu nu blochează vocea.
async function workLoop() {
  for (;;) {
    try {
      const job = await pull('work')
      if (!job) continue
      if (job.kind === 'repair') {
        // Repairs are NOT executed by this unattended server worker (safety).
        // Return empty so the request is handled supervised elsewhere.
        await sendReply(job.id, '')
        log(`Reparatie ignorata pe server (se fac supravegheat): ${job.id.slice(0, 8)}`)
        continue
      }
      void (async () => {
        await acquireWork()
        try {
          await handleWorkJob(job)
        } catch (e) {
          log(`Eroare pe lucrul ${job.id.slice(0, 8)}: ${e.message}`)
          await sendReply(job.id, '').catch(() => {})
        } finally {
          releaseWork()
        }
      })()
    } catch (e) {
      // 3s, nu 10s (Adrian: „se blochează") — un sughiț de rețea nu mai lasă
      // puntea moartă zece secunde; long-poll-ul oricum absoarbe graba.
      log(`Eroare work loop: ${e.message} — reincerc in 3s`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

// WATCHDOG DE AUTO-RECONECTARE (Adrian, 13 iul: „repară să nu mai cadă chatul la
// deploy"). La un redeploy al backendului acesta se schimbă; în cazuri rare long-poll-ul
// rămâne wedged / sesiunea intră în stare moartă → puntea pare „vie" dar e
// deconectată și cerea repornire MANUALĂ. Acum: dacă nu mai atinge backendul
// WATCHDOG_MS (3+ cicluri de long-poll ratate), ieșim intenționat; systemd
// (Restart=always, verificat pe VPS) respawnează procesul curat, care se
// reconectează din prima. Auto-vindecare, zero intervenție manuală.
const WATCHDOG_MS = 90_000
setInterval(() => {
  const gap = Date.now() - lastReach
  if (gap > WATCHDOG_MS) {
    log(`WATCHDOG: fără contact cu backendul de ${Math.round(gap / 1000)}s — ies, systemd mă repornește curat.`)
    process.exit(1)
  }
}, 15_000).unref?.()

chatLoop()
workLoop()
