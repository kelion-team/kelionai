// ── TOTUL PE MONITOR (Adrian, Aug 2, 10:13 — "TOT pe monitor") ──────────────
//
// His complaint at 10:04: he asked "Câte grade sunt afară?" and the Stage
// showed ONLY the avatar — no weather card, no visual, nothing. The monitor
// is Kelion's PRIMARY display surface; a turn that has something displayable
// must light it up, every time.
//
// The live cause was upstream (chat.ts): the LIGHT-TURN RACE answers chit-chat
// with NO tools offered (`runOrchestrator(id, orMsgs, [], ...)`) — and a
// weather question classifies as "light", so get_weather could never run, no
// screen_url existed, and no {monitor} frame could ever be written. Two
// deterministic helpers fix both ends of that without any extra model call:
//
//   needsToolForAnswer(text) — skips the tool-less race for questions that
//     obviously need live data (weather, maps, video, search/news/prices, a
//     pasted URL, the time elsewhere). They take the sequential path WITH
//     tools, so the tool's screen_url reaches the monitor as designed.
//
//   autoPreviewFrame(text) — the end-of-turn safety net: when the brain did
//     NOT call show_document/show_on_screen but its final answer still carries
//     an obviously displayable payload (a URL, an image link, map coordinates,
//     a markdown table, a code block), we build ONE sensible visual from it
//     and push it to the monitor. Never more than one, never when a surface
//     was already shown this turn (the caller guards that).
//
// Both are pure, deterministic and cheap — no network, no model.

// One control-frame payload, exactly the shapes ChatPanel.handleControl reads.
export interface MonitorPreview {
  monitor?: { url: string; title: string }
  doc?: { title: string; text: string }
  card?: {
    type: string
    title: string
    items: { primary: string; secondary?: string; meta?: string }[]
  }
}

// ── THE QUESTIONS THAT NEED A TOOL ──────────────────────────────────────────
// The light-turn race is for chit-chat only ("salut", "ce faci"). A question
// whose honest answer is LIVE DATA must never race tool-less: it would be
// answered from stale model memory AND the monitor would stay dark. Kept
// deliberately tight — a false positive only costs the race's speed (the
// model still decides whether to call a tool); a false negative is Adrian's
// empty monitor.
const TOOL_QUESTION_RE = new RegExp(
  [
    // weather — RO + EN ("Câte grade sunt afară?", "ce vreme e", "weather")
    '\\bvrem[eiu]\\w*|prognoz\\w*|temperatur\\w*|grade\\b|plou[ăa]|[îi]nghe[țt]\\w*|ninge\\w*|senin\\b',
    'weather|forecast|temperature\\w*|raining|sunny|snowing',
    // maps / directions / "where am I" / "near me"
    'hart[ăa]\\w*|drumul?\\b|rut[ăa]\\w*|naviga\\w*|unde\\s+(?:sunt|m[ăa]\\s+aflu|e\\s+)',
    '\\bmap\\b|directions|\\broute\\b|near\\s+me|where\\s+am\\s+i',
    // video / music — YouTube surface
    'youtube|youtu\\.be|\\bvideo\\w*|clip(?:ul)?\\b|muzic[ăa]|melodie|pies[ăa]\\w*',
    '\\bsong\\b|\\bmusic\\b|\\bwatch\\b',
    // search / news / prices / exchange — live web data
    'caut[ăa]?(?:\\s+(?:pe\\s+)?(?:net|google|web))?\\b|[șs]tiri\\w*|nout[ăa][țt]\\w*',
    '\\bsearch\\b|\\bnews\\b|latest\\s+\\w+|pre[țt]\\w*|curs(?:ul)?\\s+(?:valutar|valutei)',
    'cotat\\w*|burs[ăa]\\w*|bitcoin|cripto\\w*|\\bprice\\w*|\\bstock\\w*|crypto\\w*',
    // the time elsewhere ("cât e ceasul în Tokyo")
    'c[âa]t\\s+e\\s+ceasul|or(?:a|ul)\\s+(?:actual|local)|fus\\s+orar',
    'what\\s+time\\s+is\\s+it|time\\s+in\\s+\\w+|time\\s*zone',
    // IMAGE GENERATION (agenții de debug, 3 aug: „deseneaza/genereaza o imagine"
    // nu trecea de poarta asta → cursa fără unelte → generate_image nu era
    // chemat NICIODATĂ pe calea publică — exact „zice că n-a chemat unealta").
    'desen[ea]\\w*|genereaz[ăa]\\s+(?:o\\s+)?(?:imagin|poz|pictur)\\w*|creeaz[ăa]\\s+(?:o\\s+)?(?:imagin|poz|logo|sigl)\\w*',
    '(?:o\\s+)?imagine\\s+cu\\b|f[ăa]\\s*-?\\s*(?:mi|ne)?\\s+(?:o\\s+)?(?:poz[ăa]|imagine|desen|logo|sigl[ăa])',
    '\\bdraw\\b|generate\\s+(?:an?\\s+)?(?:image|picture|photo|logo)|create\\s+(?:an?\\s+)?(?:image|picture|logo)|make\\s+(?:me\\s+)?(?:an?\\s+)?(?:image|picture|logo)',
  ].join('|'),
  'i',
)

/** True when the question obviously needs live data/tools — the light-turn
 *  race (which offers NO tools) must skip these and take the tool path. */
export function needsToolForAnswer(text: string): boolean {
  const t = String(text ?? '')
  if (!t.trim()) return false
  // A pasted URL is a request to open/read/show something — always a tool turn.
  if (/https?:\/\//i.test(t)) return true
  return TOOL_QUESTION_RE.test(t)
}

// ── THE END-OF-TURN AUTO-PREVIEW ────────────────────────────────────────────

// Trailing punctuation a sentence naturally glues to a URL is not part of it.
function cleanUrl(u: string): string {
  return u.replace(/[.,;:!?)\]}"'»”]+$/g, '')
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)([?#].*)?$/i

// Hosts that categorically refuse framing (X-Frame-Options) and give a dead
// "refused to connect" panel — never auto-preview those; the frontend's own
// embeddable Google Maps (/maps/embed) stays allowed.
function refusesIframe(raw: string): boolean {
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'google.com' || host.endsWith('.google.com')) {
      return !u.pathname.startsWith('/maps')
    }
    return false
  } catch {
    return false
  }
}

// A decimal coordinate pair: "44.4268, 26.1025" (Bucharest) — lat ±90, lon ±180,
// at least 3 decimals so "3, 5" in a sentence never becomes a map.
const COORDS_RE = /(-?\d{1,2}\.\d{3,})\s*[,; ]\s*(-?\d{1,3}\.\d{3,})/

// A markdown table: at least one header line and a `|---|` separator line.
function extractMarkdownTable(text: string): string[] | null {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'))
  if (lines.length < 2) return null
  if (!lines.some((l) => /\|[\s:-]*-{3,}[\s:|-]*\|/.test(l))) return null
  return lines
}

function tableToCard(lines: string[]): MonitorPreview['card'] | null {
  const rows = lines
    .filter((l) => !/\|[\s:-]*-{3,}[\s:|-]*\|/.test(l)) // drop the separator
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    )
    .filter((cells) => cells.some((c) => c !== ''))
  if (rows.length === 0) return null
  const header = rows[0]
  const data = rows.slice(1)
  const items = (data.length > 0 ? data : rows).slice(0, 30).map((cells) => ({
    primary: cells[0] ?? '',
    secondary: cells[1] || undefined,
    meta: cells.length > 2 ? cells.slice(2).join(' · ') : undefined,
  }))
  if (!items.length) return null
  return {
    type: 'table',
    title: header.slice(0, 3).join(' · ') || 'Table',
    items,
  }
}

const CODE_BLOCK_RE = /```(\w{0,20})[ \t]*\r?\n([\s\S]*?)```/

/** Inspect the final answer for ONE obviously displayable payload and build
 *  the monitor frame for it. Priority: image → map coordinates → generic URL
 *  → markdown table → code block. Plain prose → null (the monitor stays as it
 *  is; nothing sensible to show). */
export function autoPreviewFrame(raw: string): MonitorPreview | null {
  const text = String(raw ?? '')
  if (!text.trim()) return null

  // 1–3. URLs: image first, then any embeddable page. Coordinates beat a
  // generic URL only when no URL exists — a real link is more specific.
  const urls = (text.match(/https?:\/\/[^\s|<>"')\]]+/gi) ?? []).map(cleanUrl).filter(Boolean)
  const imageUrl = urls.find((u) => IMAGE_EXT_RE.test(u))
  if (imageUrl) return { monitor: { url: imageUrl, title: 'Image' } }
  const pageUrl = urls.find((u) => !refusesIframe(u))
  if (pageUrl) return { monitor: { url: pageUrl, title: '' } }

  // 2. Map coordinates in prose ("sunt la 44.4268, 26.1025") → harta NOASTRĂ
  // same-origin (8 aug: iframe-ul openstreetmap.org apărea „întotdeauna" ca
  // pagină prăbușită în Chrome-ul ownerului — cadrele de pe alt domeniu pot fi
  // ucise de blocante; /api/route nu poate).
  const m = COORDS_RE.exec(text)
  if (m) {
    const lat = Number(m[1])
    const lon = Number(m[2])
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return {
        monitor: {
          url: `/api/route?punct=${lat},${lon}`,
          title: 'Map',
        },
      }
    }
  }

  // 4. A markdown table → the generic card surface (one row = one card item).
  const table = extractMarkdownTable(text)
  if (table) {
    const card = tableToCard(table)
    if (card && card.items.length > 0) return { card }
  }

  // 5. A fenced code block → the readable document panel (monospace, copyable).
  const code = CODE_BLOCK_RE.exec(text)
  if (code && code[2].trim()) {
    const lang = code[1].trim()
    return {
      doc: { title: lang ? `Code (${lang})` : 'Code', text: code[2].replace(/\s+$/g, '') },
    }
  }

  // 6. ORICE RĂSPUNS PE MONITOR (owner, 19 aug: „Kelion nu înțelege că orice
  // răspuns trebuie afișat DOAR pe monitor"). Până azi proza simplă lăsa
  // monitorul gol — afișarea depindea de model să cheme show_document, iar el
  // „nu înțelegea" s-o facă de fiecare dată. Acum plasa deterministă pune ȘI
  // proza pe monitor, ca document lizibil: nu mai depinde de bunăvoința
  // modelului, orice răspuns se vede. (Doar când nimic altceva n-a aprins
  // ecranul — gardul `!surfaceShown` din chat.ts; o unealtă care a arătat deja
  // ceva câștigă.) Titlu = prima linie scurtă, ca tabul să aibă etichetă.
  const proza = text.trim()
  if (proza) {
    const primaLinie = (proza.split('\n').find((l) => l.trim()) ?? '').trim()
    const titlu = primaLinie.length <= 48 ? primaLinie : `${primaLinie.slice(0, 47)}…`
    return { doc: { title: titlu, text: proza } }
  }

  return null
}
