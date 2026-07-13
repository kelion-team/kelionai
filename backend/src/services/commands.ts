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

// What the client executes verbatim: a camera op, a monitor-tab op, or a
// server-resolved YouTube open (the server picks a real video and emits the
// {monitor} frame separately).
export interface DeviceCommand {
  camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
  screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
  youtube?: { query: string }
}

// NB: Unicode lookbehind, not \b — JS \b is ASCII-only and never matches
// before "î", so the spoken "închide" (real diacritics from Chirp STT) would
// be dead with a plain word boundary.
const CLOSE_VERB =
  /(?<![\p{L}\p{N}])(închide|inchide|închid|ascunde|opre[șs]t[eiî]|close|hide|dismiss|cierra|cerrar|ferme|fermer|schlie[sß]|закро)\w*/iu
const SCREEN_NOUN =
  /\b(harta|hart[ăa]|ecran\w*|monitor\w*|map|screen|video|imagin\w*|image|fereastr\w*|window|pagin\w*|page|asta|aceasta|acesta|it|that|tot)\b/i
// "Switch to <task>" — narrow verbs only, so "arată-mi harta Romei" (new
// content) still reaches Kelion; a bare switch just changes the active surface.
const SWITCH_VERB =
  /(?<![\p{L}\p{N}])(comut[ăa]?|treci|revino|switch|schimb[ăa]\s+la|mergi\s+la|back\s+to|înapoi\s+la|inapoi\s+la)(?![\p{L}])/iu
const CLOSE_ALL = /\b(tot|totul|toate|everything|all)\b/i

// Map words the user says to a monitor task kind (the tab to switch/close).
function taskKindFromText(msg: string): string | null {
  if (/\b(hart[ăa]|harta|map|rut[ăa]|ruta|traseu\w*|route|directions|navigat\w*)\b/i.test(msg))
    return 'map'
  if (/\b(youtube|video\w*|clip\w*|film\w*|melodi\w*|pies[ăa]|muzic\w*|song)\b/i.test(msg))
    return 'youtube'
  if (/\b(meteo|vreme\w*|vremea|weather|windy)\b/i.test(msg)) return 'weather'
  if (/\b(imagin\w*|poz[ăa]\w*|poza|image|picture)\b/i.test(msg)) return 'image'
  if (/\b(pagin\w*|pagina|site\w*|web|articol\w*|page)\b/i.test(msg)) return 'web'
  if (/\b(document\w*|documentul|text\w*|textul|email\w*|emailul|scrisoare\w*|nota|notă)\b/i.test(msg))
    return 'doc'
  return null
}

// YouTube/dance/video intent — deterministic, zero model cost. When Adrian says
// "vreau pe youtube", "pune un clip de dans" etc., the server resolves a real
// video (via youtubeFirstEmbed in chat.ts) and shows it on the monitor.
function youtubeOp(raw: string): { query: string } | null {
  const m = (raw ?? '').trim()
  if (!m) return null
  const intentRe =
    /(?<![\p{L}\p{N}])(vreau(?:\s+(?:să\s+)?(?:văd|ascult|pun))?|pune(?:-?(?:mi|ți|ti|m|t|i))?|deschide|porne[sșț]te|porneste|arat[ăa](?:-mi)?|arata-mi|red[ăa]|comut[ăa]|treci|las[ăa]|lasa|ascult[ăa]|asculta|d[ăa](?:-mi)?)\s+(?:pe\s+)?(?:youtube|un\s+(?:clip|videoclip|video)|muzic[ăa])(?![\p{L}\p{N}])/iu
  // Also catch "<topic> pe youtube" when a concrete style is named.
  const styleYoutubeRe =
    /\b(dans|dance|hip[- ]?hop|rock|pop|clasic[ăa]|electro(?:nic[ăa])?|house|techno|trap|ballet|salsa|tango|breakdance|manele?)\s+(?:pe\s+)?youtube\b/iu
  if (!intentRe.test(m) && !styleYoutubeRe.test(m)) return null
  // Prefer a concrete dance/music style if named; otherwise default to "dans"
  // because the owner's explicit request is "a dance video on YouTube".
  const topicRe =
    /\b(dans|dance|hip[- ]?hop|rock|pop|clasic[ăa]|electro(?:nic[ăa])?|house|techno|trap|ballet|salsa|tango|breakdance|manele?)\b/i
  const topic = topicRe.exec(m)
  return { query: topic ? topic[1] : 'dans' }
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

  const youtube = youtubeOp(msg)
  if (youtube) return { youtube }

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
  if (cmd.youtube) {
    return ro
      ? `Caut un clip de ${cmd.youtube.query} pe YouTube.`
      : `Searching YouTube for ${cmd.youtube.query}.`
  }
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
export type GestureLabel = 'raiseRightHand' | 'salute' | 'pointMonitor'

const GESTURE_KEYWORDS: { label: GestureLabel; patterns: RegExp[] }[] = [
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
    }
  }
  switch (label) {
    case 'raiseRightHand':
      return 'Ridic mâna dreaptă.'
    case 'salute':
      return 'Salut.'
    case 'pointMonitor':
      return 'Arăt spre monitor.'
  }
}
