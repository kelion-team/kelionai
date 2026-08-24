import { config } from '../config.js'
import { cheltuialaLunaPeKinduri } from '../db.js'
import { getSerperBalance } from './serperBalance.js'
import { openaiHealth } from './openaiResponses.js'
type Masuratoare<T> =
  | { masurat: true; cum: string; valoare: T; ms: number; la: string }
  | { masurat: false; cum: string; motiv: string; ms: number; la: string }

// ── CÂT CREDIT A MAI RĂMAS, PE FIECARE AI (Adrian, 8 aug 2026) ──────────────
//
// „pe lângă tot ce faci adaugă și raportarea reală a creditului rămas pe
//  fiecare AI".
//
// Cuvântul care contează e REALĂ. Pentru unii furnizori soldul CHIAR se poate
// citi (Serper are `/account`), pentru alții NU EXISTĂ un asemenea API — Google
// nu expune „câți bani mai ai" prin API-ul de inferență sau Cloud Billing.
// Tentația e să pun un 0 sau o estimare frumoasă în locul gol. Aia e exact
// familia care l-a costat: „£0.00", „Cardul: necreat", „0 creați, 0 eșuați" —
// o citire imposibilă, prezentată ca fapt.
//
// De-aia fiecare cifră de aici e o `Masuratoare<T>`: ori a fost citită ȘI are
// valoare ȘI spune CUM a fost citită, ori n-a fost citită ȘI spune DE CE.
// TypeScript nu-mi dă voie să scot un număr din varianta picată — regula nu
// stă într-un comentariu, stă în tip.
//
// Cele trei feluri de rând, ca omul să știe la ce se uită:
//   • CITIT DE LA FURNIZOR   — soldul adevărat (Serper)
//   • SOCOTIT                — cifra pe care a spus-o ownerul, minus cheltuiala
//                              noastră MĂSURATĂ. Se vede în `cum` din ce e
//                              făcută, ca s-o poată controla.
//   • NU POT VERIFICA        — furnizorul nu dă sold; se arată unde e factura.

export interface CreditAI {
  /** Numele furnizorului, cum îl știe ownerul. */
  furnizor: string
  /** Ce anume din aplicație se duce pe banii lui. */
  alimenteaza: string
  /** Cheia e pusă în mediu? Măsurat din config, nu presupus. */
  cheieConfigurata: boolean
  /** Creditul RĂMAS. Varianta picată n-are valoare — doar motiv. */
  ramas: Masuratoare<{ cantitate: number; unitate: string }>
  /** Cât s-a dus luna asta pe el, din jurnalul nostru de costuri. */
  cheltuitLuna: Masuratoare<{ usd: number }>
  /** Cheia răspunde ACUM? (doar unde se poate atinge ieftin) */
  serveste?: Masuratoare<{ da: boolean; detaliu?: string }>
  /** Unde se vede factura, când soldul nu e citibil prin API. */
  facturare?: string
  /** `ramas` e un SOLD REAL citit de la furnizor (Serper /account, RunPod
   *  clientBalance) — atunci 0 chiar înseamnă „fără credit". FALS/lipsă = `ramas`
   *  e o ESTIMARE, care se învechește la auto-reload
   *  și NU are voie să aprindă roșul; pentru ăștia decide pingul de viață. */
  soldReal?: boolean
}

// ── BECUL DE CREDIT (owner, 13 aug: „un bec roșu/verde care indică credit sau
// lipsă… 402 înseamnă că nu are credit") ─────────────────────────────────────
// Trei stări ONESTE, derivate DOAR din măsurători (regula #1 — niciodată verde
// fals):
//   • verde = are credit MĂSURAT (sold citit > 0) SAU servește ACUM
//   • rosu  = fără credit MĂSURAT (sold citit ≤ 0, ex. RunPod 402/„positive
//             balance", Serper 0) SAU pingul spune clar că NU servește.
//   • gri   = NU pot verifica (furnizorul nu are API de sold, cheia lipsește,
//             citire picată). NU verde — necunoscutul nu se maschează în „e ok".
// (Starea „roșu pâlpâind" = auto-alimentare eșuată/card gol vine cu auto-alimentarea,
// nu de aici — becul ăsta raportează doar creditul citit, nu tentativa de plată.)
export type BecCredit = 'verde' | 'rosu' | 'gri'

export function beculCredit(c: CreditAI): BecCredit {
  // (1) SOLD REAL citit de la furnizor (Serper /account, RunPod clientBalance):
  // aici cifra e adevărul — 0 = fără credit (402) → ROȘU; > 0 → VERDE.
  if (c.soldReal && c.ramas.masurat) {
    return c.ramas.valoare.cantitate > 0 ? 'verde' : 'rosu'
  }
  // (2) FĂRĂ sold real: furnizorul nu expune soldul, iar estimarea
  // „declarat − cheltuit" se ÎNVECHEȘTE la fiecare auto-reload pe care nu-l vedem
  // (owner, 13 aug: bec ROȘU fals deși contul avea credit, auto-reload ON). Deci
  // lumina vine din PINGUL DE VIAȚĂ — servește = are credit — nu din estimare.
  // Estimarea rămâne doar cifra afișată, nu decide culoarea.
  if (c.serveste?.masurat) {
    return c.serveste.valoare.da ? 'verde' : 'rosu'
  }
  // (3) Fallback: un sold (chiar și estimat) citit > 0 → verde; altfel nimic
  // măsurabil → GRI („nu pot verifica"), niciodată verde fals (regula #1).
  if (c.ramas.masurat && c.ramas.valoare.cantitate > 0) return 'verde'
  return 'gri'
}

const acum = (): string => new Date().toISOString()

const reusit = <T,>(cum: string, valoare: T, ms: number): Masuratoare<T> => ({
  masurat: true,
  cum,
  valoare,
  ms,
  la: acum(),
})

const picat = <T,>(cum: string, motiv: string, ms = 0): Masuratoare<T> => ({
  masurat: false,
  cum,
  motiv,
  ms,
  la: acum(),
})

/** Cheltuiala lunii pentru un set de feluri de cost, ca măsurătoare. */
async function cheltuiala(kinds: string[]): Promise<Masuratoare<{ usd: number }>> {
  const t0 = Date.now()
  const cum = `SUM(cost_usd_micros) din cost_events pe luna curentă, felurile: ${kinds.join(', ')}`
  const r = await cheltuialaLunaPeKinduri(kinds)
  if (!r.ok) return picat(cum, 'jurnalul de costuri nu se poate citi (baza de date)', Date.now() - t0)
  return reusit(cum, { usd: r.usd }, Date.now() - t0)
}

/** O singură clasificare pentru toate costurile runtime ale providerului AI. */
export const FELURI_OPENAI = ['openai', 'chat', 'memory', 'memory_est', 'image', 'image_est', 'video', 'asr_openai', 'realtime']

async function randSerper(): Promise<CreditAI> {
  const t0 = Date.now()
  const [sold, cheltuitLuna] = await Promise.all([getSerperBalance().catch(() => null), cheltuiala(['search'])])
  const cum = 'GET https://google.serper.dev/account (soldul spus de furnizor)'
  const ramas: Masuratoare<{ cantitate: number; unitate: string }> = !sold
    ? picat(cum, 'citirea la Serper a picat', Date.now() - t0)
    : !sold.ok
      ? picat(cum, sold.error === 'not_configured' ? 'cheia Serper nu e pusă în mediu' : (sold.error ?? 'răspuns neînțeles'), Date.now() - t0)
      : reusit(cum, { cantitate: sold.balance, unitate: 'căutări rămase' }, Date.now() - t0)

  return {
    furnizor: 'Serper',
    alimenteaza: 'căutarea pe web a lui Kelion',
    cheieConfigurata: Boolean(config.serperKey),
    ramas,
    cheltuitLuna,
    // SOLD REAL (Serper /account) — 0 chiar înseamnă „fără credit", deci becul
    // poate fi roșu pe cifra citită. Link-ul are butonul „Top up".
    soldReal: true,
    facturare: 'https://serper.dev/dashboard',
  }
}

// Constructorul are propria stare de worker și nu este prezentat ca sold API.

async function randOpenAI(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.openai.key)
  const t0 = Date.now()
  const live = cheieConfigurata ? await openaiHealth().catch(() => null) : null
  const ms = Date.now() - t0
  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> | undefined = !cheieConfigurata
    ? undefined
    : !live
      ? picat('POST /v1/responses prin calea chatului', 'verificarea a eșuat', ms)
      : live.ok
        ? reusit('POST /v1/responses prin calea chatului', { da: live.serving, detaliu: live.reason }, ms)
        : picat('POST /v1/responses prin calea chatului', live.reason ?? 'eroare necunoscută', ms)
  return {
    furnizor: 'OpenAI',
    alimenteaza: 'Creier chat (text + vedere + reasoning)',
    cheieConfigurata,
    ramas: picat(
      'OpenAI nu expune sold prin API',
      cheieConfigurata
        ? 'platform.openai.com nu oferă endpoint de sold; creditul real se vede în dashboard'
        : 'cheia OPENAI_API_KEY nu e configurată',
    ),
    cheltuitLuna: await cheltuiala(FELURI_OPENAI),
    serveste,
    facturare: 'https://platform.openai.com/settings/organization/billing/overview',
  }
}

/** Raportul complet, un rând pe furnizor. Un rând care n-a putut fi citit
 *  RĂMÂNE în listă, cu motivul lui — dispariția tăcută ar fi tot o minciună. */
export async function crediteAI(): Promise<CreditAI[]> {
  return Promise.all([randSerper(), randOpenAI()])
}
