import { config } from '../config.js'
import { cheltuialaLunaPeKinduri, loadKv } from '../db.js'
import { getSerperBalance } from './serperBalance.js'
import { geminiLive } from './geminiDirect.js'
import type { Masuratoare } from './masurare.js'

// ── CÂT CREDIT A MAI RĂMAS, PE FIECARE AI (Adrian, 8 aug 2026) ──────────────
//
// „pe lângă tot ce faci adaugă și raportarea reală a creditului rămas pe
//  fiecare AI".
//
// Cuvântul care contează e REALĂ. Pentru unii furnizori soldul CHIAR se poate
// citi (Serper are `/account`), pentru alții NU EXISTĂ un asemenea API — Google
// nu expune „câți bani mai ai" nici prin Gemini API, nici prin Cloud Billing.
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
  const cum = `SUM(cost_usd) din cost_events pe luna curentă, felurile: ${kinds.join(', ')}`
  const r = await cheltuialaLunaPeKinduri(kinds)
  if (!r.ok) return picat(cum, 'jurnalul de costuri nu se poate citi (baza de date)', Date.now() - t0)
  return reusit(cum, { usd: r.usd }, Date.now() - t0)
}

/** Creditul pe care l-a declarat ownerul pentru Gemini (kv `gemini:credit`). */
async function creditDeclaratGemini(): Promise<{ gbp: number; at?: string } | null> {
  try {
    const brut = await loadKv('gemini:credit')
    if (!brut) return null
    const c = JSON.parse(brut) as { gbp?: number; at?: string }
    if (!Number.isFinite(c.gbp) || (c.gbp as number) < 0) return null
    return { gbp: c.gbp as number, at: typeof c.at === 'string' ? c.at : undefined }
  } catch {
    return null
  }
}

async function randGemini(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.geminiKey)
  const [cheltuitLuna, declarat, live] = await Promise.all([
    // Toate felurile care se plătesc la Google prin cheia Gemini. Le enumăr aici
    // ca să se poată AUDITA suma — nu „costul AI", ci exact rândurile astea.
    cheltuiala(['gemini', 'chat', 'memory', 'memory_est', 'image', 'image_est', 'video']),
    creditDeclaratGemini(),
    geminiLive().catch(() => null),
  ])

  const cumRamas =
    'Google nu expune sold prin API (nici Gemini API, nici Cloud Billing): ' +
    'cifra e creditul spus de tine minus cheltuiala măsurată a lunii'

  let ramas: Masuratoare<{ cantitate: number; unitate: string }>
  if (!declarat) {
    ramas = picat(
      cumRamas,
      'nu mi-ai spus niciun credit (Admin → „Credit Gemini"), iar Google nu-l dă automat — nu inventez o cifră',
    )
  } else if (!cheltuitLuna.masurat) {
    ramas = picat(cumRamas, `am creditul spus de tine (£${declarat.gbp}), dar ${cheltuitLuna.motiv}`)
  } else {
    ramas = reusit(
      `${cumRamas} — spus de tine: £${declarat.gbp}${declarat.at ? ` la ${declarat.at.slice(0, 10)}` : ''}; cheltuit luna asta: $${cheltuitLuna.valoare.usd.toFixed(2)}`,
      { cantitate: Number((declarat.gbp - cheltuitLuna.valoare.usd).toFixed(2)), unitate: 'GBP (aproximativ, cheltuiala e în USD)' },
      0,
    )
  }

  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> = !live
    ? picat('un apel mic la modelul curent (maxOutputTokens: 1)', 'pingul către Gemini a picat')
    : !live.ok
      ? picat('un apel mic la modelul curent (maxOutputTokens: 1)', live.reason ?? 'cheie lipsă')
      : reusit('un apel mic la modelul curent (maxOutputTokens: 1)', { da: live.serving, detaliu: live.reason }, 0)

  return {
    furnizor: 'Gemini (Google AI)',
    alimenteaza: 'creierul: chat, viziune, imagini, video, memorie',
    cheieConfigurata,
    ramas,
    cheltuitLuna,
    serveste,
    facturare: 'https://aistudio.google.com/apikey',
  }
}

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
    facturare: 'https://serper.dev/dashboard',
  }
}

async function randGoogleCloud(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.googleServiceAccountJson || config.googleTtsKey)
  return {
    furnizor: 'Google Cloud (voce + traducere + agenți)',
    alimenteaza: 'ascultarea (STT), vocea (TTS), traducerea, agenții Enterprise',
    cheieConfigurata,
    ramas: picat(
      'nu există endpoint de sold: Cloud Billing dă costuri, nu „cât mai ai"',
      cheieConfigurata
        ? 'Google nu expune credit rămas pentru contul de facturare — se vede doar în consolă; ce pot măsura e cheltuiala noastră, mai jos'
        : 'nu e configurat niciun cont de serviciu / cheie TTS',
    ),
    cheltuitLuna: await cheltuiala(['asr', 'voice_minutes', 'tts:*']),
    facturare: 'https://console.cloud.google.com/billing',
  }
}

async function randJules(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.julesKey)
  return {
    furnizor: 'Jules (agent de cod Google)',
    alimenteaza: 'sarcini de cod pornite de Kelion',
    cheieConfigurata,
    ramas: picat(
      'API-ul Jules nu are endpoint de sold',
      cheieConfigurata ? 'furnizorul nu publică sold; cota se vede în contul Google' : 'cheia Jules nu e pusă în mediu',
    ),
    // Jules nu trece prin `recordCost` — nu am de unde scoate o cheltuială, și
    // nu pun 0 în locul gol.
    cheltuitLuna: picat(
      'jurnalul de costuri (cost_events)',
      'Jules nu înregistrează costuri la noi — n-am ce măsura, deci nu raportez o cifră',
    ),
    facturare: 'https://jules.google.com',
  }
}

/** Raportul complet, un rând pe furnizor. Un rând care n-a putut fi citit
 *  RĂMÂNE în listă, cu motivul lui — dispariția tăcută ar fi tot o minciună. */
export async function crediteAI(): Promise<CreditAI[]> {
  return Promise.all([randGemini(), randSerper(), randGoogleCloud(), randJules()])
}
