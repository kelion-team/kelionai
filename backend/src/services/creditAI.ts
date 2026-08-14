import { config } from '../config.js'
import { cheltuialaDeLaPeKinduri, cheltuialaLunaPeKinduri, loadKv } from '../db.js'
import { getSerperBalance } from './serperBalance.js'
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
  const [cheltuitLuna, declarat, live, facturare] = await Promise.all([
    // Lista auditabilă a felurilor e FELURI_GEMINI (exportată, folosită și de
    // pastila din bară — aceeași sumă peste tot, nu două liste divergente).
    cheltuiala(FELURI_GEMINI),
    creditDeclaratGemini(),
    geminiLive().catch(() => null),
    // CALEA OFICIALĂ (owner, 14 aug: „dacă e soluție oficială, de ce nu o
    // facem?"): cheltuiala + creditele REALE din exportul Cloud Billing →
    // BigQuery (facturareGoogle.ts). Până când ownerul dă rolul + pornește
    // exportul în consolă, întoarce ok:false cu PASUL exact rămas — și becul
    // rămâne pe estimarea declarată, spus cinstit.
    import('./facturareGoogle.js').then((m) => m.facturareGoogle()).catch(() => null),
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
      // „£0.00" NU înseamnă creier mort (14 aug: estimarea pe zero a fost citită
      // drept „Gemini nu poate" — dar creierul RĂSPUNDEA, a și construit #230 cu
      // 2,3M tokeni). Estimarea e declarativă și se învechește; adevărul despre
      // capacitate e becul «servește» (apel REAL la model). Când estimarea ajunge
      // pe zero, o spunem în clar, ca cifra să nu mai poată fi citită drept verdict.
      const notaZero =
        r.ramasGbp <= 0 ? ' · ATENȚIE: estimare pe declarația ta (posibil veche), NU soldul Google — capacitatea reală o arată becul «servește»' : ''
      ramas = reusit(
        `${cumRamas} — spus de tine: £${declarat.gbp}${declarat.at ? ` la ${declarat.at.slice(0, 10)}` : ''}; ` +
          `cheltuit de atunci: $${r.scazutUsd.toFixed(2)} × curs ${r.curs.toFixed(4)}${notaZero}`,
        { cantitate: r.ramasGbp, unitate: 'GBP' },
        Date.now() - t0,
      )
    }
  }
  // CIFRA REALĂ DE LA GOOGLE (owner, 14 aug: „dacă e soluție oficială, de ce nu
  // o facem?"): exportul Cloud Billing → BigQuery, citit cu contul de serviciu.
  // Când e activ, se ARATĂ lângă estimare (nu o înlocuiește tăcut — ferestrele
  // și moneda diferă); când NU e încă activ, se scrie PASUL exact rămas în
  // consolă — deci panoul îți spune singur ce mai e de apăsat, nu tace.
  if (facturare) {
    const nota = facturare.ok
      ? ` · GOOGLE REAL (export, din ${facturare.date.dinData || '—'}): cheltuit ${facturare.date.cheltuitUsd.toFixed(2)} · credite aplicate ${facturare.date.crediteUsd.toFixed(2)} (moneda contului)`
      : ` · export Google: ${facturare.motiv}`
    ramas = { ...ramas, cum: `${ramas.cum}${nota}` }
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

/** ── FABLE 5 (Claude): REZERVA creierului constructorului (owner, 14 aug) ──────
 *  „schimbă-mi constructorul cu gemeni ultra… când nu merge repara vreau să cadă pe
 *  fable 5". Constructorul rulează pe Gemini (PRINCIPAL — vezi rândul Gemini) și cade
 *  pe Fable 5 când Gemini nu poate. Fable 5 merge PRIN APP (cheia ANTHROPIC_API_KEY
 *  stă în app, nu în constructor). Anthropic NU expune un sold prin API public → nu
 *  inventez o cifră (regula #1); becul vine din PROBA REALĂ a cheii la Anthropic:
 *  validă = VERDE, invalidă/lipsă = ROȘU — MĂSURAT, deci niciodată GRI. */
async function randFable(): Promise<CreditAI> {
  const { fable5Disponibil, fable5Valida } = await import('./fable5Constructor.js')
  const activa = fable5Disponibil()
  // PROBA REALĂ (owner, 14 aug: becul verde a MINȚIT — cheia era pusă dar
  // INVALIDĂ, rezerva moartă, raportul „gata", constructorul blocat). De-acum
  // „servește" = dovada de la Anthropic (GET /v1/models, gratuit, cache 10 min),
  // nu prezența cheii în env. O cheie pusă dar refuzată = ROȘU, cu motivul exact.
  const proba = await fable5Valida()
  return {
    furnizor: 'Fable 5 (Claude — rezerva constructorului)',
    alimenteaza: 'creierul constructorului când Gemini nu poate repara (rezervă)',
    cheieConfigurata: activa,
    // Fără sold real: Anthropic nu expune „cât mai ai" prin API public → nu fabricăm
    // o cifră; becul vine din „servește" (proba cheii), nu dintr-un 0 fals.
    ramas: picat(
      'Anthropic nu expune sold prin API public — se vede în consolă (Billing)',
      activa
        ? 'Anthropic nu dă „cât mai ai" prin API; cheltuiala se vede în consola Anthropic'
        : 'cheia Fable 5 (ANTHROPIC_API_KEY) nu e pusă în app — rezerva e INACTIVĂ',
    ),
    // Anthropic nu trece prin jurnalul nostru de costuri — nu pun 0 în locul gol.
    cheltuitLuna: picat(
      'jurnalul de costuri (cost_events)',
      'Fable 5 (Anthropic) nu trece prin jurnalul nostru — n-am ce măsura, deci nu raportez o cifră',
    ),
    serveste: reusit(
      'proba REALĂ a cheii la Anthropic (GET /v1/models — gratuit, cache 10 min)',
      { da: proba.ok, detaliu: proba.motiv },
      0,
    ),
    // Link-ul EXACT de reîncărcare/facturare Anthropic.
    facturare: 'https://console.anthropic.com/settings/billing',
  }
}

/** Raportul complet, un rând pe furnizor. Un rând care n-a putut fi citit
 *  RĂMÂNE în listă, cu motivul lui — dispariția tăcută ar fi tot o minciună. */
export async function crediteAI(): Promise<CreditAI[]> {
  return Promise.all([randGemini(), randSerper(), randFable(), randGoogleCloud(), randJules()])
}
