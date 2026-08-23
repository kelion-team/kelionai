import { config } from '../config.js'
import { cheltuialaLunaPeKinduri } from '../db.js'
import { getSerperBalance } from './serperBalance.js'
import { geminiLive } from './geminiDirect.js'
import { contServiciuGoogleServesteLive } from './tokenChecks.js'
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
export const FELURI_OPENAI = ['openai']

async function randGemini(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.geminiKey)
  const t0 = Date.now()
  const [cheltuitLuna, live, facturare, soldExport] = await Promise.all([
    // Lista auditabilă a felurilor e FELURI_GEMINI (exportată, folosită și de
    // pastila din bară — aceeași sumă peste tot, nu două liste divergente).
    cheltuiala(FELURI_GEMINI),
    geminiLive().catch(() => null),
    // CALEA OFICIALĂ (owner, 14 aug: „dacă e soluție oficială, de ce nu o
    // facem?"): cheltuiala + creditele REALE din exportul Cloud Billing →
    // BigQuery (facturareGoogle.ts).
    import('./facturareGoogle.js').then((m) => m.facturareGoogle()).catch(() => null),
    // SOLDUL DERIVAT (ordinul din 15 aug: „valoarea reală… trebuie citit
    // automat"): full_amount − aplicat, per credit, din același export. Calea
    // declarată de mână («credit Gemini») A MURIT odată cu ordinul — o cifră
    // spusă de om se învechea la fiecare auto-reload și pastila ajungea să
    // mintă (£0.00 lângă un sold real de £25.80).
    import('./facturareGoogle.js').then((m) => m.soldCrediteGoogle()).catch(() => null),
  ])

  const cumRamas =
    'soldul DERIVAT din exportul oficial Cloud Billing → BigQuery: totalul acordat ' +
    '(credits.full_amount) minus creditele aplicate, per credit — zero cifre declarate de om'

  let ramas: Masuratoare<{ cantitate: number; unitate: string }>
  if (soldExport?.ok && soldExport.date.soldTotal != null) {
    const detaliu = soldExport.date.credite
      .filter((c) => c.sold != null)
      .map((c) => `${c.nume}: ${c.sold} din ${c.total}`)
      .join(' · ')
    ramas = reusit(
      `${cumRamas} — ${detaliu}`,
      { cantitate: soldExport.date.soldTotal, unitate: soldExport.date.moneda || 'moneda contului' },
      Date.now() - t0,
    )
  } else if (soldExport?.ok) {
    ramas = picat(
      cumRamas,
      'exportul are credite dar fără full_amount pe niciunul — nu pot deriva soldul fără să inventez',
      Date.now() - t0,
    )
  } else {
    ramas = picat(cumRamas, soldExport?.motiv ?? 'citirea soldului din export a picat', Date.now() - t0)
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

  // ALERTĂ FALSĂ „fără credit" SCOASĂ (owner 20 aug: „primeste o alerta falsa gemeni
  // lipsa credit, scoate alerta de la gemeni de tot"). Google NU expune soldul prepay,
  // deci un ping care NU întoarce 200 nu e dovadă de „fără credit" (regula #1) — nu mai
  // aprindem ROȘU pe el. Verde apare DOAR pe 200 real; orice altceva rămâne „nu pot
  // verifica" (gri), nu „fără credit". Alerta REALĂ de credit vine doar dintr-un eșec
  // MĂSURAT în chatul viu (402/quota), cu link de reîncărcare (routes/chat.ts).
  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> = !live
    ? picat('un apel mic la modelul curent (maxOutputTokens: 1)', 'pingul către Gemini a picat')
    : !live.ok
      ? picat('un apel mic la modelul curent (maxOutputTokens: 1)', live.reason ?? 'cheie lipsă')
      : live.serving
        ? reusit('un apel mic la modelul curent (maxOutputTokens: 1)', { da: true }, 0)
        : picat(
            'un apel mic la modelul curent (maxOutputTokens: 1)',
            `Google a răspuns dar nu a servit (${live.reason ?? '—'}); soldul prepay nu e citibil, deci NU confirm „fără credit"`,
          )

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
  // SERVEȘTE = CHECK LIVE, nu JSON.parse (owner, 19 aug: „bec verde din JSON.parse").
  // Chiar obținem un access token de la Google; o cheie revocată/dezactivată dar
  // parsabilă PICĂ acum (verde = Google a răspuns, nu „JSON-ul e valid").
  const saLive = await contServiciuGoogleServesteLive()
  const serveste: Masuratoare<{ da: boolean; detaliu?: string }> = reusit(
    'cont de serviciu Google răspunde LIVE (access token) sau cheie TTS pusă',
    {
      da: saLive.ok || Boolean(config.googleTtsKey),
      detaliu: saLive.ok
        ? `Google a răspuns — STT/TTS/traducere (${saLive.detaliu})`
        : config.googleTtsKey
          ? 'cheie TTS pusă (rezervă)'
          : saLive.detaliu || 'nimic configurat',
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

// (randJules a IEȘIT din becuri, 15 aug — ordinul „rezervă tăcută, invizibilă"
// + „și pastila ascunsă". Sonda lui trăiește în unealta jules_repos din
// adminTools: la ordinul explicit al ownerului, Kelion tot poate măsura dacă
// Jules servește — dar nimic nu se mai afișează nechemat.)

// (RÂNDUL „Fable 5 (rezerva constructorului)" a fost SCOS — owner, 16 aug:
// „fable iese total de peste tot… ramine doar gemini rapid si cu escaladarea
// pe modelul performant gemini". Constructorul rulează pe motorul Aider, iar
// creierul lui e DOAR Gemini — nu mai există rezervă Fable de arătat.)

async function randOpenAI(): Promise<CreditAI> {
  const cheieConfigurata = Boolean(config.openai.key)
  const t0 = Date.now()
  let serveste: Masuratoare<{ da: boolean; detaliu?: string }> | undefined
  if (cheieConfigurata) {
    const r = await fetch('https://api.openai.com/v1/models?limit=1', {
      headers: { Authorization: `Bearer ${config.openai.key}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null)
    const ms = Date.now() - t0
    if (r && r.ok) {
      serveste = reusit('GET /v1/models cu OPENAI_API_KEY', { da: true }, ms)
    } else {
      serveste = reusit('GET /v1/models cu OPENAI_API_KEY', { da: false, detaliu: r ? `HTTP ${r.status}` : 'fetch failed' }, ms)
    }
  }
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
  // JULES = REZERVĂ TĂCUTĂ, INVIZIBILĂ (owner, 15 aug: „Pune-l rezerva tacuta,
  // invizibil" + „si pastila ascunsa", după dovada: 12 zile de la integrare,
  // ZERO PR-uri din ramuri jules/*). Pastila lui a ieșit din bară; serviciul
  // (services/jules.ts) și uneltele jules_* RĂMÂN — Kelion îl poate chema DOAR
  // la ordinul explicit al ownerului. randJules există mai jos pentru sonda
  // la cerere (julesServeste prin unealtă), nu pentru afișaj.
  return Promise.all([randGemini(), randSerper(), randGoogleCloud(), randOpenAI()])
}
