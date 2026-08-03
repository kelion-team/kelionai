// ── THE CARD AT PROVIDERS, PUT BY HIM, AT YOUR REQUEST, RECOGNIZED BY VOICE ──
//
// Adrian, Jul 31: "that was the requirement that proved real autonomy" · "he
// should operate for me when only I ask, using the voice recognition system,
// as heightened security."
//
// I kept this step closed for a whole day, and I had a good reason — but only
// half of it was valid. The two problems are DIFFERENT:
//
//   WHO is allowed → solved by the voiceprint. `hasVoiceUnlock` requires the
//   session to be unlocked SPECIFICALLY by voice, not by a typed secret: a
//   code can be stolen or read over the shoulder; the voice requires you to be
//   YOU, there.
//
//   WHAT LEAKS → solved here. A card typed with a plain `browser_type` would
//   land in three places at once: in the conversation (the model gets it as an
//   argument), in the monitor's screenshots, and in the page text returned
//   after each step. Three copies of a PAN, in three logs.
//
// The solution: the model NEVER gets the value. It only says "field 7 is the
// card number", and the SERVER types there, taking the value from env. Plus
// discreet mode for the whole duration: zero screenshots, digits masked in the
// text.
//
// What stays yours, once: the card values are put as secrets in GitHub, by
// your hand. NOT through Kelion — `secret_pune` refuses by construction
// anything that looks like a card, and stays that way. For the most sensitive
// value in the system, a manual step is preferable to an automation that can
// err.
import { browserType, setModDiscret, browserRead, mascheazaCifre } from './browser.js'
import type { BrowserResult } from './browser.js'
import { voceRecenta } from './adminLock.js'
import { loadKv, saveKv } from '../db.js'
import { config } from '../config.js'
import type { ExpenseLine } from '../shared/api-types.js'

/** The fields it can fill in. Their names do NOT give away the value. */
export type CampCard = 'numar' | 'expirare' | 'cvc' | 'nume' | 'cod_postal'

const DIN_ENV: Record<CampCard, string> = {
  numar: 'CARD_NUMAR',
  expirare: 'CARD_EXPIRARE',
  cvc: 'CARD_CVC',
  nume: 'CARD_NUME',
  cod_postal: 'CARD_COD_POSTAL',
}

/** Which fields are configured — without saying WHAT they contain. */
export function cardConfigurat(): { gata: boolean; lipsesc: CampCard[] } {
  const lipsesc = (Object.keys(DIN_ENV) as CampCard[]).filter((c) => !(process.env[DIN_ENV[c]] ?? '').trim())
  // The postal code is optional — not all providers ask for it.
  const esentiale = lipsesc.filter((c) => c !== 'cod_postal')
  return { gata: esentiale.length === 0, lipsesc }
}

/**
 * Types a card field's value INTO THE PAGE, without the model ever seeing it.
 *
 * Returns only the page state (already masked by discreet mode) and WHICH
 * field was filled — never what was typed. If the value isn't configured, it
 * says so plainly: better "CARD_NUMAR is missing" than a wrongly filled field
 * on a payment page.
 */
export async function completeazaCard(
  email: string,
  baseUrl: string,
  camp: CampCard,
  index: number,
): Promise<{ ok: boolean; camp: CampCard; detaliu: string; pagina?: BrowserResult }> {
  // THE GATE REQUESTED BY THE OWNER: "only when I ask, through voice
  // recognition". Not "you're admin" — but "you spoke NOW and I recognized
  // you". An admin cookie can be stolen; this window opens only when your
  // voiceprint matched, and it closes itself in 15 minutes.
  if (!voceRecenta(email)) {
    return {
      ok: false,
      camp,
      detaliu:
        'nu ating cardul fără să te fi recunoscut după voce. Vorbește-mi (o frază ajunge), ' +
        'apoi cere-mi din nou — fereastra ține 15 minute și se închide singură.',
    }
  }
  const cheie = DIN_ENV[camp]
  if (!cheie) return { ok: false, camp, detaliu: `câmp necunoscut: ${String(camp)}` }
  const valoare = (process.env[cheie] ?? '').trim()
  if (!valoare) {
    return {
      ok: false,
      camp,
      detaliu:
        `nu e configurat ${cheie}. Se pune O SINGURĂ DATĂ, de mâna ownerului, în ` +
        `GitHub → Settings → Secrets → Actions, apoi se rulează vps-set-env. ` +
        `NU prin mine: uneltele mele refuză din construcție orice arată a card.`,
    }
  }
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, camp, detaliu: 'index de câmp invalid — citește întâi pagina' }
  }
  // Discreet mode is turned on HERE, not left in anyone's care: from the
  // moment a card is typed, the page is no longer allowed on the monitor.
  setModDiscret(email, true)
  const pagina = await browserType(email, baseUrl, index, valoare, false)
  return {
    ok: !('error' in pagina),
    camp,
    detaliu: 'error' in pagina ? `pagina a refuzat: ${pagina.error}` : `am completat „${camp}" în câmpul ${index}`,
    pagina,
  }
}

// ── AUTOMATIC PAYMENTS — THE GOAL, not the card ──────────────────────────────
//
// Adrian, Jul 31: "the automatic payments". A card put into a form is not the
// target; the target is for the provider to charge ITSELF, so Kelion never
// stops for lack of credit, without the owner pressing anything.
//
// So the step is not "I filled the fields", but "the provider's page now shows
// a card on file AND auto-recharge turned on". And that's MEASURED by the code
// here, on the page text, not declared by the model (the owner's rule #1: a
// value that didn't come from a successful read is not a value).

/** Card on file: "•••• 4242", "ending in 4242", "card on file", "Visa …4242". */
const MARCA_CARD =
  /(?:[•*·x]{2,}\s?\d{4}|ending\s+in\s+\d{4}|card\s+on\s+file|payment\s+method\s+(?:added|on file)|se\s+termină\s+în\s+\d{4})/i
/** Automatic payment on: auto-recharge / auto top-up / automatic payments. */
const MARCA_AUTOMAT =
  /(?:auto[-\s]?(?:recharge|reload|top[-\s]?up|renew(?:al)?|pay(?:ment)?s?)|automatic\s+(?:payments?|billing|recharge)|recurring\s+(?:payment|billing)|reîncărcare\s+automată|plăți\s+automate)/i

export interface StareFurnizor {
  /** The provider's name, said by it: "openrouter", "anthropic"… */
  furnizor: string
  /** The page text showed a card on file, at session close. */
  card: boolean
  /** …and auto-recharge turned on. THIS is the goal. */
  automat: boolean
  /** The page fragment the match was made on (masked). */
  dovada: string
  cand: string
}

const CHEIE = 'card:furnizori'

/** Which providers are configured — READ from what was measured, not from promises. */
export async function stareFurnizori(): Promise<StareFurnizor[]> {
  try {
    const raw = await loadKv(CHEIE)
    const j = raw ? (JSON.parse(raw) as StareFurnizor[]) : []
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

/** The proof for the mission: at least one provider with automatic payment ON. */
export async function platiAutomatePornite(): Promise<boolean> {
  return (await stareFurnizori()).some((f) => f.automat)
}

/** The application's expenses and where each is paid from — the `expenses`
 *  field of the money circuit. IT USED TO LIVE IN stripe.ts and DIED WITH IT
 *  (Aug 1, #624): nobody noticed that removing Stripe silently removed this
 *  list, and the panel — whose whole status block was gated on it — went
 *  blank ("mai jos nu mai e nimic", Adrian, Aug 2). Rebuilt HERE, next to the
 *  kv it enriches from: `configured` is the key existing in config (a read,
 *  not a promise), `cardPus`/`platiAutomate` come ONLY from what `card_gata`
 *  MEASURED on the provider's page — absent if nobody was ever there, because
 *  "I don't know" must never be written as "no" (rule #1). */
export async function cheltuieliAplicatiei(): Promise<ExpenseLine[]> {
  const masurat = await stareFurnizori()
  const gaseste = (nume: string): StareFurnizor | undefined =>
    masurat.find((f) => f.furnizor.toLowerCase().includes(nume.toLowerCase()))
  const linie = (
    name: string,
    what: string,
    configured: boolean,
    billing: string,
    billingUrl?: string,
  ): ExpenseLine => {
    const m = gaseste(name)
    return {
      name,
      what,
      configured,
      billing,
      ...(billingUrl ? { billingUrl } : {}),
      ...(m ? { cardPus: m.card, platiAutomate: m.automat } : {}),
    }
  }
  // OpenRouter + OpenAI SCOASE din listă (Adrian, 3 aug: „setările sunt din
  // openrouteri și celălalt, și asta se scoate" — migrare completă pe Gemini).
  // Creierul, urechea, gura, vederea, imaginile, constructorul: toate pe cheia
  // Gemini a ownerului. Rămân doar cardurile care CHIAR se schimbă în aplicație:
  // Gemini (creier+voce+vedere), Serper (căutare web), Google (tier gratuit).
  return [
    linie(
      'Gemini',
      'the brain, ears, mouth and eyes (all Kelion)',
      !!config.geminiKey,
      'your card',
      'https://aistudio.google.com/billing',
    ),
    linie('Serper', 'the web search', !!config.serperKey, 'your card', 'https://serper.dev/dashboard'),
    linie(
      'Google',
      'the Chirp 3 voice and ears',
      !!(config.googleTtsKey || config.googleServiceAccountJson),
      'free tier (1M chars/month)',
    ),
  ]
}

async function noteazaFurnizor(s: StareFurnizor): Promise<void> {
  const toate = await stareFurnizori()
  const fara = toate.filter((f) => f.furnizor !== s.furnizor)
  await saveKv(CHEIE, JSON.stringify([...fara, s].slice(-20))).catch(() => {})
}

/**
 * Closes the discreet session and MEASURES what remained on the page.
 *
 * The order matters: we read WHILE discreet mode is still on (so no screenshot
 * and with the digits masked), and only then turn it off. The other way —
 * like the first version — the last read would have photographed exactly the
 * payment page on which we had just typed the card.
 */
export async function terminaCard(
  email: string,
  baseUrl: string,
  furnizor = '',
): Promise<{ pagina: BrowserResult; card: boolean; automat: boolean; detaliu: string }> {
  const pagina = await browserRead(email, baseUrl)
  setModDiscret(email, false)
  const text = 'error' in pagina ? '' : pagina.text
  const potrivireCard = MARCA_CARD.exec(text)
  const potrivireAuto = MARCA_AUTOMAT.exec(text)
  const card = Boolean(potrivireCard)
  const automat = Boolean(potrivireAuto)
  const nume = furnizor.trim().toLowerCase().slice(0, 40)
  if (nume && (card || automat)) {
    await noteazaFurnizor({
      furnizor: nume,
      card,
      automat,
      dovada: mascheazaCifre(`${potrivireCard?.[0] ?? ''} ${potrivireAuto?.[0] ?? ''}`.trim()).slice(0, 200),
      cand: new Date().toISOString(),
    })
  }
  const detaliu = !nume
    ? 'sesiunea de card e închisă (fără furnizor spus → n-am ce nota)'
    : automat
      ? `la ${nume}: card la dosar ȘI plată automată — măsurat pe pagină`
      : card
        ? `la ${nume}: card la dosar, dar NU văd plata automată pornită pe pagină. Pornește-o, apoi cheamă din nou card_gata.`
        : `la ${nume}: nu văd nici card la dosar, nici plată automată pe pagina asta. Nu notez nimic — nu declar ce n-am măsurat.`
  return { pagina, card, automat, detaliu }
}
