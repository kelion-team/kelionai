import { config } from '../config.js'
import { cheltuialaDeLaPeKinduri, cheltuialaLunaPeKinduri, loadKv } from '../db.js'
import { getSerperBalance } from './serperBalance.js'
import { getRunpodBalance } from './runpodBalance.js'
import { geminiLive } from './geminiDirect.js'
import { cursUsdGbp } from './fx.js'
import { julesServeste } from './jules.js'
import { googleServiceAccount } from './googleCreds.js'
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
  /** `ramas` e un SOLD REAL citit de la furnizor (Serper /account, RunPod
   *  clientBalance) — atunci 0 chiar înseamnă „fără credit". FALS/lipsă = `ramas`
   *  e o ESTIMARE (Gemini: declarat − cheltuit), care se învechește la auto-reload
   *  și NU are voie să aprindă roșul; pentru ăștia decide pingul de viață. */
  soldReal?: boolean
}

// ── BECUL DE CREDIT (owner, 13 aug: „un bec roșu/verde care indică credit sau
// lipsă… 402 înseamnă că nu are credit") ─────────────────────────────────────
// Trei stări ONESTE, derivate DOAR din măsurători (regula #1 — niciodată verde
// fals):
//   • verde = are credit MĂSURAT (sold citit > 0) SAU servește ACUM
//   • rosu  = fără credit MĂSURAT (sold citit ≤ 0, ex. RunPod 402/„positive
//             balance", Serper 0) SAU pingul spune clar că NU servește (Gemini
//             „depleted"). Ăsta e semnalul cel mai onest de „adaugă credit aici".
//   • gri   = NU pot verifica (Google/Jules n-au API de sold, cheie lipsă,
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
  // (2) FĂRĂ sold real (Gemini): Google NU expune soldul, iar estimarea
  // „declarat − cheltuit" se ÎNVECHEȘTE la fiecare auto-reload pe care nu-l vedem
  // (owner, 13 aug: bec ROȘU fals deși Gemini avea £9.59, auto-reload ON). Deci
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
  const cum = `SUM(cost_usd) din cost_events pe luna curentă, felurile: ${kinds.join(', ')}`
  const r = await cheltuialaLunaPeKinduri(kinds)
  if (!r.ok) return picat(cum, 'jurnalul de costuri nu se poate citi (baza de date)', Date.now() - t0)
  return reusit(cum, { usd: r.usd }, Date.now() - t0)
}

/** Toate felurile de cost care se plătesc la Google prin cheia Gemini. Lista e
 *  scrisă O DATĂ și exportată, ca pastila din bară și raportul pe furnizori să
 *  scadă EXACT aceleași rânduri — două liste ar fi divergat în tăcere. */
export const FELURI_GEMINI = ['gemini', 'chat', 'memory', 'memory_est', 'image', 'image_est', 'video']

/** ── CE-A MAI RĂMAS DIN CREDITUL DECLARAT (Adrian, 8 aug: „asta trebuie să
 *  scadă real cum e afișat la ei pe site") ───────────────────────────────────
 *
 *  Creditul declarat e soldul din MOMENTUL declarării, deci din el se scade
 *  DOAR cheltuiala de DUPĂ acel moment — nu luna întreagă (prima variantă
 *  scădea luna, adică și banii arși înainte de declarare: pastila ar fi mințit
 *  în jos). Iar cheltuiala e în USD și creditul în GBP: conversia se face pe
 *  cursul CITIT de la BCE (fx.ts), nu scăzând USD din GBP ca și cum ar fi
 *  aceeași monedă (a doua greșeală a primei variante). Orice verigă picată →
 *  `ok:false` cu motiv, niciodată o cifră cârpită. */
export async function ramasDinDeclarat(declarat: {
  gbp: number
  at?: string
}): Promise<{ ok: true; ramasGbp: number; scazutUsd: number; curs: number } | { ok: false; motiv: string }> {
  if (!declarat.at) return { ok: false, motiv: 'creditul declarat nu are dată — nu știu de când să scad' }
  const [scazut, curs] = await Promise.all([
    cheltuialaDeLaPeKinduri(declarat.at, FELURI_GEMINI),
    cursUsdGbp(),
  ])
  if (!scazut.ok) return { ok: false, motiv: 'jurnalul de costuri nu se poate citi (baza de date)' }
  if (!curs.ok) return { ok: false, motiv: `cursul USD→GBP nu s-a putut citi (${curs.motiv})` }
  return {
    ok: true,
    ramasGbp: Math.max(0, Number((declarat.gbp - scazut.usd * curs.rate).toFixed(2))),
    scazutUsd: Number(scazut.usd.toFixed(2)),
    curs: curs.rate,
  }
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
    // Lista auditabilă a felurilor e FELURI_GEMINI (exportată, folosită și de
    // pastila din bară — aceeași sumă peste tot, nu două liste divergente).
    cheltuiala(FELURI_GEMINI),
    creditDeclaratGemini(),
    geminiLive().catch(() => null),
  ])

  const cumRamas =
    'Google nu expune sold prin API (nici Gemini API, nici Cloud Billing): ' +
    'cifra e creditul spus de tine minus cheltuiala măsurată de la declarare, pe cursul BCE'

  let ramas: Masuratoare<{ cantitate: number; unitate: string }>
  if (!declarat) {
    ramas = picat(
      cumRamas,
      'nu mi-ai spus niciun credit (Admin → „Credit Gemini"), iar Google nu-l dă automat — nu inventez o cifră',
    )
  } else {
    const t0 = Date.now()
    const r = await ramasDinDeclarat(declarat)
    if (!r.ok) {
      ramas = picat(cumRamas, `am creditul spus de tine (£${declarat.gbp}), dar ${r.motiv}`, Date.now() - t0)
    } else {
      ramas = reusit(
        `${cumRamas} — spus de tine: £${declarat.gbp}${declarat.at ? ` la ${declarat.at.slice(0, 10)}` : ''}; ` +
          `cheltuit de atunci: $${r.scazutUsd.toFixed(2)} × curs ${r.curs.toFixed(4)}`,
        { cantitate: r.ramasGbp, unitate: 'GBP' },
        Date.now() - t0,
      )
    }
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
    // soldReal LIPSĂ intenționat (estimare declarat−cheltuit, nu sold citit):
    // becul vine din `serveste`, nu din estimarea care se învechește la auto-reload.
    // Link-ul EXACT de reîncărcare, dat de owner (contul lui de facturare).
    facturare: 'https://aistudio.google.com/billing?billing=011729-7DA3DA-87ED94',
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
    // SOLD REAL (Serper /account) — 0 chiar înseamnă „fără credit", deci becul
    // poate fi roșu pe cifra citită. Link-ul are butonul „Top up".
    soldReal: true,
    facturare: 'https://serper.dev/dashboard',
  }
}

async function randGoogleCloud(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.googleServiceAccountJson || config.googleTtsKey)
  // VERDE/ROȘU, nu gri (owner, 13 aug: „culorile la fel pt toți AI"). Google nu dă
  // „cât mai ai", dar pot spune dacă e OPERAȚIONAL: cont de serviciu cu JSON valid
  // (parsabil + client_email) sau cheie TTS pusă → verde; nimic → roșu. Măsurat.
  const saValid = Boolean(googleServiceAccount())
  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> = reusit(
    'cont de serviciu Google valid (JSON parsabil) sau cheie TTS pusă',
    {
      da: saValid || Boolean(config.googleTtsKey),
      detaliu: saValid ? 'cont de serviciu valid — STT/TTS/traducere' : config.googleTtsKey ? 'cheie TTS pusă' : 'nimic configurat',
    },
    0,
  )
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
    serveste,
    facturare: 'https://console.cloud.google.com/billing',
  }
}

async function randJules(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.julesKey)
  // VERDE/ROȘU, nu gri: ping real la API-ul Jules (GET surse, fără cost). Cheia
  // pusă + API răspunde → verde; lipsă cheie sau API pică → roșu.
  const live = await julesServeste()
  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> = reusit(
    'ping Jules (GET surse) — cheia pusă și API-ul răspunde',
    { da: live.ok, detaliu: live.detaliu },
    0,
  )
  return {
    furnizor: 'Jules (agent de cod Google)',
    alimenteaza: 'sarcini de cod pornite de Kelion',
    cheieConfigurata,
    serveste,
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

/** ── RUNPOD: placa lucrătorului, cu SOLD CITIT REAL (Adrian, 12 aug) ──────────
 *  Constructorul rulează pe modelul propriu (Qwen3-Coder) pe o placă RunPod
 *  serverless — NU pe VPS. Spre deosebire de Google, RunPod EXPUNE soldul
 *  (GraphQL myself.clientBalance), deci aici cifra e CITITĂ, nu estimată. Cheia
 *  e cea a constructorului (CONSTRUCTOR_DEEPSEEK_KEY, dacă URL-ul e RunPod). */
async function randRunpod(): Promise<CreditAI> {
  const t0 = Date.now()
  const sold = await getRunpodBalance().catch(() => null)
  const cum = 'POST https://api.runpod.io/graphql { myself { clientBalance } } (soldul spus de RunPod)'
  const cheieConfigurata =
    Boolean((process.env.CONSTRUCTOR_RUNPOD_KEY ?? process.env.CONSTRUCTOR_DEEPSEEK_KEY ?? '').trim()) &&
    /runpod\.ai/i.test(process.env.CONSTRUCTOR_RUNPOD_URL ?? process.env.CONSTRUCTOR_DEEPSEEK_URL ?? '')

  // SOLD REAL doar când furnizorul CHIAR expune o cifră (RunPod clientBalance).
  // BUG prins de owner (13 aug, „0 USD" roșu deși DeepInfra servește): când
  // constructorul e pe DeepInfra, `getRunpodBalance` întoarce ok:true DAR fără
  // `balanceUsd` (DeepInfra nu expune sold). Codul făcea `balanceUsd ?? 0` = un 0
  // FABRICAT → bec roșu fals, exact „£0.00". Acum: dacă nu vine o cifră reală, NU
  // inventăm 0 — spunem „nu pot verifica" și becul vine din „servește" (verde).
  let ramas: Masuratoare<{ cantitate: number; unitate: string }>
  let soldReal = false
  if (!sold || sold.error === 'not_runpod') {
    ramas = picat(cum, 'constructorul nu e pus pe RunPod (URL-ul nu e RunPod)', Date.now() - t0)
  } else if (sold.error === 'not_configured') {
    ramas = picat(cum, 'cheia constructorului nu e pusă (CONSTRUCTOR_RUNPOD_KEY / _DEEPSEEK_KEY)', Date.now() - t0)
  } else if (!sold.ok) {
    ramas = picat(cum, `citirea soldului a picat (${sold.error})`, Date.now() - t0)
  } else if (typeof sold.balanceUsd === 'number') {
    // RunPod EXPUNE soldul → cifră reală; aici 0 chiar înseamnă „fără credit" (402).
    ramas = reusit(cum, { cantitate: Number(sold.balanceUsd.toFixed(2)), unitate: 'USD' }, Date.now() - t0)
    soldReal = true
  } else {
    // Furnizor găzduit (DeepInfra) care SERVEȘTE dar NU expune sold prin API — nu
    // fabricăm un 0; becul vine din „servește" (verde), soldul se vede pe dashboard.
    ramas = picat(
      `${sold.provider ?? 'furnizorul'} nu expune sold prin API`,
      `${sold.provider ?? 'furnizorul'} servește, dar soldul se vede doar pe dashboard-ul lui — nu inventez un 0`,
      Date.now() - t0,
    )
  }

  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> = sold?.ok
    ? reusit(
        'sold RunPod citit',
        { da: true, detaliu: `rată acum $${(sold.currentSpendPerHr ?? 0).toFixed(3)}/h · plafon $${sold.spendLimitPerHr ?? '?'}/h` },
        0,
      )
    : picat('sold RunPod', 'nu s-a putut citi soldul RunPod')

  return {
    // Numele REAL al furnizorului (DeepInfra/RunPod/…), nu „RunPod" fix — altfel
    // pastila minte când constructorul e pe DeepInfra (owner: „0 USD" pe RunPod
    // deși e pe DeepInfra).
    furnizor: `${sold?.provider ?? 'RunPod'} (creierul constructorului)`,
    alimenteaza: 'creierul constructorului — modelul care execută ordinele de build',
    cheieConfigurata,
    // SOLD REAL doar unde furnizorul expune o cifră (RunPod). DeepInfra: soldReal
    // fals → becul vine din „servește", nu dintr-un 0 fabricat.
    soldReal,
    ramas,
    // RunPod nu trece prin jurnalul nostru de costuri (worker-ul nu itemizează
    // cost per apel). Soldul real de mai sus e măsura DIRECTĂ — nu pun un 0 fals.
    cheltuitLuna: picat(
      'jurnalul de costuri (cost_events)',
      'RunPod nu trece prin jurnalul nostru — soldul real de mai sus e măsura directă a banilor rămași',
    ),
    serveste,
    // Link-ul EXACT de reîncărcare, dat de owner (consola RunPod, cu „+" de credit).
    facturare: 'https://console.runpod.io/user/billing',
  }
}

/** Raportul complet, un rând pe furnizor. Un rând care n-a putut fi citit
 *  RĂMÂNE în listă, cu motivul lui — dispariția tăcută ar fi tot o minciună. */
export async function crediteAI(): Promise<CreditAI[]> {
  return Promise.all([randGemini(), randSerper(), randRunpod(), randGoogleCloud(), randJules()])
}
