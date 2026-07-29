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
const CLOSE_VERB =
  /(?<![\p{L}\p{N}])(închide|inchide|închid|ascunde|opre[șs]t[eiî]|close|hide|dismiss|cierra|cerrar|ferme|fermer|schlie[sß]|закро)\w*/iu
const SCREEN_NOUN =
  /(?<![\p{L}\p{N}])(harta|hart[ăa]|ecran\p{L}*|monitor\p{L}*|map|screen|video|imagin\p{L}*|image|fereastr\p{L}*|window|pagin\p{L}*|page|asta|aceasta|acesta|it|that|tot)(?![\p{L}\p{N}])/iu
// "Switch to <task>" — narrow verbs only, so "arată-mi harta Romei" (new
// content) still reaches Kelion; a bare switch just changes the active surface.
const SWITCH_VERB =
  /(?<![\p{L}\p{N}])(comut[ăa]?|treci|revino|switch|schimb[ăa]\s+la|mergi\s+la|back\s+to|înapoi\s+la|inapoi\s+la)(?![\p{L}])/iu
const CLOSE_ALL = /(?<![\p{L}\p{N}])(tot|totul|toate|everything|all)(?![\p{L}\p{N}])/iu

// Map words the user says to a monitor task kind (the tab to switch/close).
// BUG REAL PRINS DE TESTE (30 iul): aici era `\b...\b`, iar în JavaScript `\b`
// e ASCII-only — după „ă"/„î"/„ș" NU se potrivește. Efectul, dovedit:
//   „treci pe hartă"  → NU făcea nimic (fără diacritic mergea);
//   „închide hartă"   → închidea TAB-UL ACTIV în loc de hartă (chiar regresia
//                        W4 #2 pe care comentariul de mai jos o crede reparată).
// Aceeași capcană ca la „Dansează!" (20 iul, AI-HANDOFF). Soluția casei, deja
// folosită de CLOSE_VERB/SWITCH_VERB din acest fișier: graniță Unicode explicită
// prin lookaround + flag `u`.
const G0 = '(?<![\\p{L}\\p{N}])' // început de cuvânt, sigur pe diacritice
const G1 = '(?![\\p{L}\\p{N}])' // sfârșit de cuvânt, sigur pe diacritice
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
  if (!/\bcamer/.test(m) && !/\bwebcam/.test(m)) return null
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

  const camera = cameraOp(msg)
  if (camera) return { camera }

  const open = Array.isArray(tabs) ? tabs : []
  if (open.length === 0) return null

  if (SWITCH_VERB.test(msg)) {
    const kind = taskKindFromText(msg)
    if (kind && open.some((t) => t.kind === kind)) return { screen: { op: 'switchKind', kind } }
  }
  if (CLOSE_VERB.test(msg)) {
    if (CLOSE_ALL.test(msg)) return { screen: { op: 'closeAll' } }
    const kind = taskKindFromText(msg)
    // W4 #2: dacă Adrian numește o suprafață anume (ex. „închide harta"), o închidem
    // DOAR dacă e chiar deschisă; altfel lăsăm creierul să răspundă — NU închidem
    // tab-ul activ (alt lucru) doar fiindcă cel numit nu e deschis.
    if (kind) {
      if (open.some((t) => t.kind === kind)) return { screen: { op: 'closeKind', kind } }
      return null
    }
    if (SCREEN_NOUN.test(msg) || msg.split(/\s+/).length <= 4) return { screen: { op: 'close' } }
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
    // „Dansează!" e comandă DIRECTĂ (Adrian, 24 iul: în test Kelion a refuzat să
    // danseze — modelul de chat nu chema unealta). Determinist, fără creier:
    // doar forme imperative clare, ca o discuție DESPRE dans să nu-l pornească.
    label: 'dans',
    patterns: [
      // FĂRĂ \b după diacritice: în JS \b se bazează pe \w (ASCII), deci după
      // „ă" nu există graniță de cuvânt → /danseaz[ăa]\b/ NU prindea „Dansează!"
      // (bug dovedit în testul live din 24 iul). Prefixul e suficient de precis.
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
