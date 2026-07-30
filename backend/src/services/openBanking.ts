// ── CITITORUL DE TRANZACȚII DIN REVOLUT PRO ──────────────────────────────────
//
// Adrian, 30 iul: „găsești soluții și plățile mi le fac prin revolut pro" +
// „fiecare plată trebuie să fie însoțită de un cod unic".
//
// Revolut Pro nu are Merchant API, deci nu poate trimite un webhook care să ne
// spună „s-a plătit". Fără asta, creditarea rămâne manuală — exact ce a refuzat.
//
// Soluția care NU cere firmă și NU aduce un procesator între noi și banii lui:
// citim tranzacțiile CONTULUI, prin Open Banking (GoCardless Bank Account Data,
// fostul Nordigen — Revolut e suportat, iar citirea e gratuită). Banii intră
// direct la el, cu comisionul lui Revolut, iar aplicația doar SE UITĂ ce a intrat
// și potrivește codul din referință cu omul care aștepta să plătească.
//
// CE NU FACE, și e important: nu mișcă bani, nu poate plăti, nu poate scoate
// nimic din cont. Accesul e strict de CITIRE — asta oferă open banking-ul pe
// partea de „account information", și doar atât cerem.
//
// LIMITA REALĂ, scrisă aici ca să nu surprindă pe nimeni: consimțământul dat
// băncii expiră (PSD2 — tipic 30-90 de zile) și trebuie reînnoit de proprietarul
// contului, cu un click. Când se apropie, aplicația trebuie să-l anunțe — altfel
// creditarea automată s-ar opri în tăcere, adică fix boala pe care am reparat-o
// azi în cinci locuri.
import { config } from '../config.js'

const API = 'https://bankaccountdata.gocardless.com/api/v2'

/** O intrare de bani, curățată de tot ce nu ne trebuie. */
export interface TranzactieIntrata {
  /** Id-ul de la bancă — cheia care face creditarea idempotentă. */
  id: string
  /** Suma, POZITIVĂ (ieșirile sunt filtrate înainte). */
  amount: number
  currency: string
  /** Textul în care căutăm codul. */
  referinta: string
}

let token: { value: string; expira: number } | null = null

/** Token de acces, ținut în memorie până aproape de expirare.
 *
 *  Întoarce null (nu aruncă) dacă lipsesc cheile sau dacă serviciul nu răspunde:
 *  apelantul trebuie să poată deosebi „n-am putut citi" de „n-a intrat nimic",
 *  fiindcă cele două cer reacții diferite (una se raportează, alta nu). */
async function getToken(): Promise<string | null> {
  if (!config.gocardless.secretId || !config.gocardless.secretKey) return null
  if (token && Date.now() < token.expira) return token.value
  const r = await fetch(`${API}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ secret_id: config.gocardless.secretId, secret_key: config.gocardless.secretKey }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!r || !r.ok) return null
  const j = (await r.json().catch(() => ({}))) as { access?: string; access_expires?: number }
  if (!j.access) return null
  // Reînnoim cu un minut înainte de expirare, ca să nu prindem fix marginea.
  token = { value: j.access, expira: Date.now() + Math.max(60, (j.access_expires ?? 3600) - 60) * 1000 }
  return token.value
}

/** Tranzacțiile INTRATE din contul configurat.
 *
 *  `null` = n-am putut citi (chei lipsă, consimțământ expirat, serviciu picat).
 *  `[]` = am citit, dar n-a intrat nimic. Două lucruri diferite, două valori
 *  diferite — regula nr. 1 din CLAUDE.md, aplicată de la început aici. */
export async function tranzactiiIntrate(): Promise<TranzactieIntrata[] | null> {
  const t = await getToken()
  if (!t || !config.gocardless.accountId) return null
  const r = await fetch(`${API}/accounts/${encodeURIComponent(config.gocardless.accountId)}/transactions/`, {
    headers: { Authorization: `Bearer ${t}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  if (!r || !r.ok) return null
  const j = (await r.json().catch(() => ({}))) as {
    transactions?: {
      booked?: {
        transactionId?: string
        internalTransactionId?: string
        transactionAmount?: { amount?: string; currency?: string }
        remittanceInformationUnstructured?: string
        remittanceInformationUnstructuredArray?: string[]
        debtorName?: string
      }[]
    }
  }
  // DOAR `booked`, niciodată `pending`: o plată în așteptare poate încă să nu
  // ajungă. Creditam pe bani care se pot întoarce — și n-am mai avea de unde
  // să-i luăm înapoi.
  const booked = j.transactions?.booked ?? []
  const out: TranzactieIntrata[] = []
  for (const t2 of booked) {
    const suma = Number(t2.transactionAmount?.amount ?? '0')
    // Ieșirile (sume negative) nu ne interesează: nu creditează pe nimeni.
    if (!(suma > 0)) continue
    const id = t2.transactionId ?? t2.internalTransactionId ?? ''
    if (!id) continue
    // Codul poate ajunge în oricare din câmpurile de referință, în funcție de
    // bancă — le lipim pe toate și căutăm în tot. Numele plătitorului intră și
    // el: unii oameni scriu codul acolo.
    const referinta = [
      t2.remittanceInformationUnstructured ?? '',
      ...(t2.remittanceInformationUnstructuredArray ?? []),
      t2.debtorName ?? '',
    ]
      .filter(Boolean)
      .join(' ')
    out.push({ id, amount: suma, currency: (t2.transactionAmount?.currency ?? 'gbp').toLowerCase(), referinta })
  }
  return out
}

// ── BUCLA CARE CREDITEAZĂ SINGURĂ ────────────────────────────────────────────
//
// „la plată se trece automat la ce cod/client" (Adrian). Aici se închide cercul:
// citim ce a intrat, căutăm codul, creditam omul. Rulează periodic, fiindcă
// nimeni nu ne poate anunța — Revolut Pro n-are webhook.
import { crediteazaDupaCod } from '../db.js'

/** Ultima trecere: ce am găsit și ce am făcut. Panoul îl citește ca să poată
 *  spune dacă sistemul chiar lucrează — o citire care nu merge NU are voie să
 *  arate ca „n-a plătit nimeni". */
let ultimaCitire: { la: string; ok: boolean; detaliu: string } | null = null
export function stareCitirePlati(): { la: string; ok: boolean; detaliu: string } | null {
  return ultimaCitire
}

/** O trecere: citește, potrivește, creditează. Întoarce câți useri au fost
 *  creditați acum. */
export async function verificaPlatiNoi(): Promise<number> {
  const tranzactii = await tranzactiiIntrate()
  if (tranzactii === null) {
    // NU tăcem și NU raportăm „0 plăți": n-am putut citi, ceea ce e cu totul
    // altceva. Dacă am scrie 0, owner-ul ar crede că nu plătește nimeni.
    ultimaCitire = {
      la: new Date().toISOString(),
      ok: false,
      detaliu: !config.gocardless.secretId
        ? 'nu e configurat (lipsesc cheile GoCardless)'
        : !config.gocardless.accountId
          ? 'nu e legat contul (lipsește GOCARDLESS_ACCOUNT_ID)'
          : 'nu pot citi tranzacțiile — consimțământul poate fi expirat, se reînnoiește din Revolut',
    }
    return 0
  }
  let creditati = 0
  let faraCod = 0
  for (const t of tranzactii) {
    const email = await crediteazaDupaCod(t.referinta, t.amount, t.currency, t.id).catch(() => null)
    if (email) {
      creditati++
      console.log(`[PLATI] ${email} creditat cu ${t.amount} ${t.currency} (tranzactia ${t.id})`)
    } else if (t.referinta && !/KLN-/i.test(t.referinta)) {
      // Intrare fără codul nostru: poate fi orice alt venit al lui, nu neapărat
      // o plată ratată. O numărăm, n-o tratăm ca eroare.
      faraCod++
    }
  }
  ultimaCitire = {
    la: new Date().toISOString(),
    ok: true,
    detaliu: `${tranzactii.length} intrări citite · ${creditati} creditate · ${faraCod} fără codul nostru`,
  }
  return creditati
}

/** Pornește verificarea periodică. Fără chei nu face nimic și n-o spune de o
 *  mie de ori — o singură dată, la pornire. */
export function startCitirePlati(): void {
  if (!config.gocardless.secretId || !config.gocardless.secretKey) {
    console.log('[PLATI] citirea automată e oprită: lipsesc cheile GoCardless')
    return
  }
  // La 5 minute: destul de des cât omul să nu aștepte după credite, destul de
  // rar cât să nu batem degeaba în API-ul băncii.
  setTimeout(() => {
    void verificaPlatiNoi().catch(() => 0)
    setInterval(() => void verificaPlatiNoi().catch(() => 0), 5 * 60 * 1000)
  }, 30_000)
}
