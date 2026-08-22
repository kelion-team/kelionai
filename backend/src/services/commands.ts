// Deterministic device-command interpreter — runs on the SERVER. The camera
// and monitor-tab commands ("închide harta", "camera spate", "switch to the
// video") used to be regex-matched in the browser; per the owner's order to
// keep as much of the app as possible on the server, the interpretation lives
// here now. /api/chat runs it on each incoming message BEFORE the brain: a
// match is answered instantly with a {device} control frame + a short ack (no
// model call), anything else flows on to the brain unchanged — so the move adds
// no latency; a matched command actually gets FASTER than a model turn.

export interface ScreenTab {
  kind: string
  title: string
  active: boolean
}

// What the client executes verbatim: a camera op, or a monitor-tab op.
export interface DeviceCommand {
  camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
  screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
}

// NB: Unicode lookbehind, not \b — JS \b is ASCII-only and never matches
// before "î", so the spoken "închide" (real diacritics from Chirp STT) would
// be dead with a plain word boundary.
// + golește/scoate/ia (vânătorul din 22 aug, MĂSURAT: „golește monitorul" —
// chiar verbul canonic al uneltei — pica pe model, care confabula „n-am
// acces"; la fel „scoate aia de pe ecran", „ia știrile de pe monitor").
const CLOSE_VERB =
  /(?<![\p{L}\p{N}])(închide|inchide|închid|ascunde|opre[șs]t[eiî]|gole[șs]te|goleste|scoate|close|hide|dismiss|cierra|cerrar|ferme|fermer|schlie[sß]|закро)\w*/iu
const IA_VERB = /(?<![\p{L}\p{N}])ia(?![\p{L}\p{N}])/iu
// + tab*/știr* (același vânător: „închide tabul cu știrile" → null).
const SCREEN_NOUN =
  /(?<![\p{L}\p{N}])(harta|hart[ăa]|ecran\p{L}*|monitor\p{L}*|tab\p{L}*|[șs]tir\p{L}*|map|screen|video|imagin\p{L}*|image|fereastr\p{L}*|window|pagin\p{L}*|page|asta|aceasta|acesta|it|that|tot)(?![\p{L}\p{N}])/iu
// "Switch to <task>" — narrow verbs only, so "arată-mi harta Romei" (new
// content) still reaches Kelion; a bare switch just changes the active surface.
const SWITCH_VERB =
  /(?<![\p{L}\p{N}])(comut[ăa]?|treci|revino|switch|schimb[ăa]\s+la|mergi\s+la|back\s+to|înapoi\s+la|inapoi\s+la)(?![\p{L}])/iu
const CLOSE_ALL = /(?<![\p{L}\p{N}])(tot|totul|toate|everything|all)(?![\p{L}\p{N}])/iu

// Map words the user says to a monitor task kind (the tab to switch/close).
// REAL BUG CAUGHT BY TESTS (30 Jul): this used to be `\b...\b`, and in
// JavaScript `\b` is ASCII-only — after "ă"/"î"/"ș" it does NOT match. The
// proven effect:
//   "treci pe hartă"  → did NOTHING (without the diacritic it worked);
//   "închide hartă"   → closed the ACTIVE TAB instead of the map (the very
//                        W4 #2 regression the comment below believed fixed).
// The same trap as "Dansează!" (20 Jul, AI-HANDOFF). The house solution,
// already used by CLOSE_VERB/SWITCH_VERB in this file: an explicit Unicode
// boundary via lookaround + the `u` flag.
const G0 = '(?<![\\p{L}\\p{N}])' // word start, safe on diacritics
const G1 = '(?![\\p{L}\\p{N}])' // word end, safe on diacritics
const cuvinte = (corp: string): RegExp => new RegExp(`${G0}(?:${corp})${G1}`, 'iu')

const RE_MAP = cuvinte('hart[ăa]|harta|map|rut[ăa]|ruta|traseu\\p{L}*|route|directions|navigat\\p{L}*')
const RE_YOUTUBE = cuvinte('youtube|video\\p{L}*|clip\\p{L}*|film\\p{L}*|melodi\\p{L}*|pies[ăa]|muzic\\p{L}*|song')
const RE_WEATHER = cuvinte('meteo|vreme\\p{L}*|vremea|weather|windy')
const RE_IMAGE = cuvinte('imagin\\p{L}*|poz[ăa]\\p{L}*|poza|image|picture')
const RE_WEB = cuvinte('pagin\\p{L}*|pagina|site\\p{L}*|web|articol\\p{L}*|page')
const RE_DOC = cuvinte('document\\p{L}*|documentul|text\\p{L}*|textul|email\\p{L}*|emailul|scrisoare\\p{L}*|nota|not[ăa]')

function taskKindFromText(msg: string): string | null {
  if (RE_MAP.test(msg)) return 'map'
  if (RE_YOUTUBE.test(msg)) return 'youtube'
  if (RE_WEATHER.test(msg)) return 'weather'
  if (RE_IMAGE.test(msg)) return 'image'
  if (RE_WEB.test(msg)) return 'web'
  if (RE_DOC.test(msg)) return 'doc'
  return null
}

// Camera control needs both the word "camera" and an action verb, so normal
// questions like "ce vezi pe cameră?" still reach the brain.
function cameraOp(raw: string): DeviceCommand['camera'] | null {
  const m = raw.toLowerCase()
  const areWebcam = /(?<![\p{L}\p{N}])webcam/iu.test(m)
  const areCamera = /(?<![\p{L}\p{N}])camer/iu.test(m)
  const areStreamOrFeed = /(?<![\p{L}\p{N}])(stream|feed|transmisi)/iu.test(m)
  const areDirectSwitch = /(?<![\p{L}\p{N}])(comut|pune|schimb|switch|flip|toggle|întoarce|intoarce).*(?<![\p{L}\p{N}])(spate|fa[țt][ăa]|front|back|rear|frontal|selfie)(?![\p{L}])/iu.test(m)
  const areVideo = /(?<![\p{L}\p{N}])video(?![\p{L}])/iu.test(m) && !/(?<![\p{L}\p{N}])(youtube|clip|film|melodi|pies[ăa]|muzic|song)/iu.test(m)

  if (!areWebcam && !areCamera && !areStreamOrFeed && !areDirectSwitch && !areVideo) return null
  // „cameră" în română înseamnă ȘI „încăpere" (Adrian, 10 aug — bug „prăjit la
  // chat"): fraze firești despre o ÎNCĂPERE cu un verb imperativ deturnau tura
  // („stinge lumina din cameră", „închide ușa camerei", „deschide fereastra din
  // cameră") — comutau camera video ȘI săreau peste creier. Refuzăm când în frază
  // apare un obiect tipic de încăpere, DACĂ nu e numit explicit dispozitivul
  // („webcam" sau „cameră video/foto/web").
  const dispozitivClar = areWebcam || /\bcamer\w*\s+(video|foto|web)\b/.test(m)
  if (
    !dispozitivClar &&
    /\b(lumin|bec|u[șs][aăi]|fereastr|geam|perete|pere[țt]|tavan|podea|priz|întrerup|intrerup|termostat|calorifer|radiator|draperi|jaluz|televizor|frigider|dulap|mobil)/u.test(m)
  )
    return null
  const has = (re: RegExp): boolean => re.test(m)
  if (has(/(?<![\p{L}\p{N}])(închide|inchide|opre[sșț]te|opreste|stinge|dezactiv|close|turn off|disconnect)/iu))
    return 'off'
  if (has(/(?<![\p{L}\p{N}])(spate|exterior|back|rear|environment)(?![\p{L}])/iu)) return 'back'
  if (has(/(?<![\p{L}\p{N}])(fa[țt][ăa]|frontal|front|selfie|user)(?![\p{L}])/iu)) return 'front'
  if (has(/(?<![\p{L}\p{N}])(comut|schimb|switch|flip|toggle|întoarce|intoarce)/iu)) return 'switch'
  if (has(/(?<![\p{L}\p{N}])(deschide|porne[sș]te|porneste|activ|open|turn on|connect|start)/iu))
    return 'on'
  return null
}

// Interpret one incoming message against the open monitor tabs. Returns the
// command to execute, or null when the message is real conversation and must
// go on to the brain. Monitor ops only fire when a matching tab is actually
// open (same fall-through the browser had): "switch to the map" with no map
// open reaches Kelion so he can OPEN one.
export function interpretDeviceCommand(
  text: string,
  tabs?: ScreenTab[] | null,
): DeviceCommand | null {
  const msg = (text ?? '').trim()
  if (!msg) return null

  // COD/SHELL/JSON/URL NU E COMANDĂ DE DISPOZITIV (owner, 16 aug: un `curl` cu
  // JSON `"stream":false,"role":"user"` a comutat camera — cuvintele tehnice din
  // payload — `stream`, `user` — păcăleau detectorul de cameră). Dacă inputul are
  // semne clare de cod/shell/JSON/URL, NU e limbaj vorbit → îl lăsăm la creier
  // (return null), nu-l tratăm ca pe o comandă de dispozitiv.
  if (/[{}]|:\/\/|--[a-z]|[|&;$`]|\bcurl\b|\bhttps?\b|"[a-z0-9_]+"\s*:/i.test(msg)) return null

  const camera = cameraOp(msg)
  if (camera) return { camera }

  const open = Array.isArray(tabs) ? tabs : []
  if (open.length === 0) return null

  if (SWITCH_VERB.test(msg)) {
    const kind = taskKindFromText(msg)
    if (kind && open.some((t) => t.kind === kind)) return { screen: { op: 'switchKind', kind } }
  }
  // „ia X de pe ecran/monitor" — verbul „ia" e prea scurt/ambiguu ca să stea
  // în CLOSE_VERB (ar prinde „ia uite"), dar cu destinația explicită e
  // comandă de închidere fără echivoc (vânătorul din 22 aug).
  const eIaDePeEcran = IA_VERB.test(msg) && /de pe (ecran|monitor)\p{L}*/iu.test(msg)
  if (CLOSE_VERB.test(msg) || eIaDePeEcran) {
    if (CLOSE_ALL.test(msg)) return { screen: { op: 'closeAll' } }
    const kind = taskKindFromText(msg)
    // W4 #2: if Adrian names a specific surface (e.g. "închide harta"), we
    // close it ONLY if it is actually open; otherwise we let the brain answer
    // — we do NOT close the active tab (a different thing) just because the
    // named one isn't open.
    if (kind) {
      if (open.some((t) => t.kind === kind)) return { screen: { op: 'closeKind', kind } }
      return null
    }
    // ≤6 cuvinte când ținta „de pe ecran/monitor" e explicită (era ≤4 pentru
    // orice — „scoate aia de pe ecran te rog" pica pe model; vânătorul 22 aug).
    const cuvinteMsg = msg.split(/\s+/).length
    if (SCREEN_NOUN.test(msg) || cuvinteMsg <= 4 || (eIaDePeEcran && cuvinteMsg <= 6) || (/de pe (ecran|monitor)\p{L}*/iu.test(msg) && cuvinteMsg <= 6))
      return { screen: { op: 'close' } }
  }
  return null
}

// Short spoken ack for a camera command; monitor ops stay silent (the action
// itself is the feedback — exactly the behaviour the browser had). ro/en are
// the two ack languages the UI ever had.
export function deviceAck(cmd: DeviceCommand, ro: boolean): string {
  switch (cmd.camera) {
    case 'off':
      return ro ? 'Am închis camera.' : 'Camera is off.'
    case 'back':
      return ro ? 'Am comutat pe camera din spate.' : 'Switched to the back camera.'
    case 'front':
      return ro ? 'Am comutat pe camera frontală.' : 'Switched to the front camera.'
    case 'switch':
      return ro ? 'Am comutat camera.' : 'Camera switched.'
    case 'on':
      return ro ? 'Am pornit camera.' : 'Camera is on.'
    default:
      return ''
  }
}

// ── AVATAR GESTURES ─────────────────────────────────────────────────────────
// One-time gestures the server can trigger on the avatar, either from a spoken
// command (interpreted deterministically here) or from the brain via the
// play_avatar_gesture tool. They play once and blend back to idle.
export type GestureLabel = 'raiseRightHand' | 'salute' | 'pointMonitor' | 'dans'

const GESTURE_KEYWORDS: { label: GestureLabel; patterns: RegExp[] }[] = [
  {
    // "Dansează!" is a DIRECT command (Adrian, 24 Jul: in the test Kelion
    // refused to dance — the chat model wasn't calling the tool).
    // Deterministic, no brain: only clear imperative forms, so a conversation
    // ABOUT dancing doesn't trigger it.
    label: 'dans',
    patterns: [
      // NO \b after diacritics: in JS \b relies on \w (ASCII), so after
      // "ă" there is no word boundary → /danseaz[ăa]\b/ did NOT catch
      // "Dansează!" (bug proven in the 24 Jul live test). The prefix is
      // precise enough.
      /\bdanseaz/i,
      /\bf[ăa]\s+un\s+dans\b/i,
      /\b(do\s+a\s+dance|dance\s+for\s+me)\b/i,
    ],
  },
  {
    label: 'raiseRightHand',
    patterns: [
      /\b(ridic[ăa]\s+(m(â|a)na\s+dreapt[ăa]|bra[țt]ul\s+drept)|raise\s+(your\s+)?right\s+(hand|arm))\b/i,
      /\bm(â|a)na\s+dreapt[ăa]\s+sus\b/i,
    ],
  },
  {
    label: 'salute',
    patterns: [
      /\b(salut[ăa](-m[aă])?|f(ă|a)\s+salut|f(ă|a)-mi\s+salut|d(ă|a)\s+un\s+salut)\b/i,
      /\b(salute(\s+me)?|give\s+a\s+salute|wave\s+hello)\b/i,
    ],
  },
  {
    label: 'pointMonitor',
    patterns: [
      /\b(arat[ăa](-mi)?\s+(spre\s+)?monitor(ul)?|point\s+(to\s+|at\s+)?the\s+monitor)\b/i,
      /\b(arat[ăa]\s+(cu\s+degetul\s+)?spre\s+ecran)\b/i,
    ],
  },
]

export function interpretGestureCommand(text: string): GestureLabel | null {
  const msg = (text ?? '').trim()
  if (!msg) return null
  for (const { label, patterns } of GESTURE_KEYWORDS) {
    if (patterns.some((re) => re.test(msg))) return label
  }
  return null
}

export function gestureAck(label: GestureLabel, ro: boolean): string {
  if (!ro) {
    switch (label) {
      case 'raiseRightHand':
        return 'Raising my right hand.'
      case 'salute':
        return 'Salute.'
      case 'pointMonitor':
        return 'Pointing at the monitor.'
      case 'dans':
        return 'Dancing!'
    }
  }
  switch (label) {
    case 'raiseRightHand':
      return 'Ridic mâna dreaptă.'
    case 'salute':
      return 'Salut.'
    case 'pointMonitor':
      return 'Arăt spre monitor.'
    case 'dans':
      return 'Dansez!'
  }
}

// ── GESTUL PE SITUAȚIE (Adrian, 5 aug: „folosește gesturile greșit, fără
// logică — implementează o logică clară pe subiect/situație") ────────────────
//
// Până acum gestul autonom îl ALEGEA creierul (unealta play_avatar_gesture),
// liber, dintr-o paletă de 15 emoții, cu un prompt „moale". Un model slab
// (Gemini 2.5-flash, pinuit) nimerea des greșit — „victorie"/„uimire" pe o
// replică neutră. Ăsta era „fără logică". Acum gestul NU se mai ghicește: îl
// decide DETERMINIST situația REALĂ a turei — ce face Kelion ACUM. O situație →
// un gest, previzibil și testabil. Numele întors = vocabularul semantic
// (salut/arata-inainte/…), pe care frontend-ul îl mapează la clipul RPM
// (GESTURE_TO_CLIP), exact ca la comenzile directe de mai sus. Comenzile
// directe („dansează", „salută") rămân neatinse (interpretGestureCommand).
export interface SituatieGest {
  /** Ultimul mesaj primit de la om. */
  userText: string
  /** Textul răspunsului lui Kelion (fără markup de unelte). */
  replyText: string
  /** A pus ceva vizibil pe monitor în tura asta (hartă/doc/card/imagine). */
  aAratat: boolean
}

// Deschideri de salut — comparate pe PRIMUL cuvânt (un salut e la început).
const SALUTURI_DESCHIDERE = new Set([
  'bună', 'buna', 'salut', 'salutare', 'noroc', 'hei', 'hey', 'hello', 'hi', 'neața', 'neata',
])
// Rămas-bun / „stai puțin" / reușită / scuză / mulțumire — Unicode-safe (cuvinte()).
const RE_RAMAS_BUN = cuvinte('pa|la revedere|noapte bun[ăa]|ne auzim|ne vedem|bye|goodbye|see you|take care')
const RE_ASTEAPTA = cuvinte('o secund[ăa]|o clip[ăa]|stai pu[țt]in|imediat|un moment|hold on|one moment|just a second')
const RE_SUCCES = cuvinte('gata|am reu[șs]it|am terminat|s-a f[ăa]cut|s-a rezolvat|rezolvat|finalizat|done')
const RE_SCUZA = cuvinte('[îi]mi pare r[ăa]u|regret|din p[ăa]cate|n-am reu[șs]it|nu am reu[șs]it|nu am putut|a e[șs]uat|sorry|unfortunately')
const RE_MULTUMESC = cuvinte('mul[țt]umesc|mersi|thank you|thanks')

function primulCuvant(text: string): string {
  return text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)[0] ?? ''
}
function scurt(text: string): boolean {
  return text.split(/\s+/).filter(Boolean).length <= 6
}

/** O logică clară: situația turei → un singur gest (sau niciunul). Numele
 *  întors e din vocabularul semantic; `null` înseamnă „nimic" (gentleman
 *  compus — pe replici neutre, informative, NU gesticulează). */
export function gestPentruSituatie(s: SituatieGest): string | null {
  const u = (s.userText ?? '').trim()
  const r = (s.replyText ?? '').trim()
  // 1. Arată ceva pe ecran → arată cu mâna spre monitor (cel mai obiectiv semn).
  if (s.aAratat) return 'arata-inainte'
  // 2. Rămas-bun (în mesajul omului SAU în replica lui Kelion) → salut de mână.
  if (RE_RAMAS_BUN.test(u) || RE_RAMAS_BUN.test(r)) return 'salut'
  // 3. Salut de deschidere (omul salută scurt, sau Kelion începe cu un salut).
  if ((scurt(u) && SALUTURI_DESCHIDERE.has(primulCuvant(u))) || SALUTURI_DESCHIDERE.has(primulCuvant(r)))
    return 'salut'
  // 4. Kelion cere să aștepți → „stai puțin".
  if (RE_ASTEAPTA.test(r)) return 'stai-putin'
  // 5. Se scuză / n-a reușit → dezamăgire ușoară. ÎNAINTEA reușitei: „n-am
  // reușit" conține „am reușit", deci scuza trebuie prinsă prima, altfel un
  // eșec ar declanșa entuziasm (bug prins de test).
  if (RE_SCUZA.test(r)) return 'dezamagire'
  // 6. A reușit / veste bună → entuziasm discret.
  if (RE_SUCCES.test(r)) return 'entuziasm'
  // 7. Omul mulțumește → mulțumire.
  if (scurt(u) && RE_MULTUMESC.test(u)) return 'multumire'
  // 8. Replică neutră, informativă → NIMIC.
  return null
}
