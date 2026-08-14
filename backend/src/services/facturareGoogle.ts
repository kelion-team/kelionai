// ── SOLDUL GEMINI, CITIT OFICIAL (owner, 14 aug: „nu poți nici măcar aproximativ
// să citești real creditele? … dacă e soluție oficială, de ce nu o facem?") ────
//
// Google NU expune soldul prin API-ul Gemini — dar FACTURAREA (Cloud Billing)
// are calea oficială: exportul de cost în BigQuery. Odată ce ownerul (o singură
// dată, în consolă): (1) dă contului de serviciu rolul „Billing Account Viewer"
// pe contul de facturare și (2) pornește Billing export → BigQuery, modulul ăsta
// citește CHELTUIALA și CREDITELE REALE — fără browser, fără login, fără risc de
// cont (varianta cu browser-scrape pe consola Google a fost refuzată explicit:
// anti-botul Google poate bloca tot contul pe care stau cheia Gemini + Gmail).
//
// Autentificare: contul de serviciu DEJA existent pe server
// (GOOGLE_SERVICE_ACCOUNT_JSON — același care face STT/TTS), prin JWT RS256 →
// token OAuth. Regula #1 prin construcție: orice treaptă lipsă (cont, rol,
// export, tabel) → { ok:false, motiv } cu pasul EXACT care lipsește — niciodată
// o cifră inventată. Cache 10 min, ca proba Fable.

import jwt from 'jsonwebtoken'
import { googleServiceAccount } from './googleCreds.js'

/** Contul de facturare al ownerului (din linkul lui de reîncărcare). */
const CONT_FACTURARE = process.env.GOOGLE_BILLING_ACCOUNT ?? '011729-7DA3DA-87ED94'
/** Datasetul BigQuery în care ownerul pornește exportul (pasul 3 din consolă). */
const DATASET = process.env.GOOGLE_BILLING_DATASET ?? 'facturare'

/** Numele STANDARD al tabelului de export (documentat de Google):
 *  gcp_billing_export_v1_<cont-cu-underscore>. */
export function tabelExport(cont = CONT_FACTURARE): string {
  return `gcp_billing_export_v1_${cont.replace(/-/g, '_')}`
}

export interface FacturareGoogle {
  /** Cheltuiala totală măsurată de Google (USD), pe fereastra cerută. */
  cheltuitUsd: number
  /** Creditele aplicate de Google (USD, pozitiv = ți s-a scăzut din cost). */
  crediteUsd: number
  /** Din ce zi începe fereastra citită. */
  dinData: string
}

const CACHE_MS = 10 * 60_000
let cache: { la: number; rezultat: { ok: true; date: FacturareGoogle } } | null = null
/** Doar pentru teste. */
export function _resetFacturare(): void {
  cache = null
}

/** Token OAuth pentru BigQuery, din contul de serviciu (JWT RS256). */
async function tokenBigQuery(): Promise<{ ok: true; token: string; proiect: string } | { ok: false; motiv: string }> {
  const sa = googleServiceAccount()
  if (!sa?.client_email || !sa.private_key || !sa.project_id) {
    return { ok: false, motiv: 'contul de serviciu Google (GOOGLE_SERVICE_ACCOUNT_JSON) lipsește sau e incomplet' }
  }
  const acum = Math.floor(Date.now() / 1000)
  let semnat: string
  try {
    semnat = jwt.sign(
      {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/bigquery.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: acum,
        exp: acum + 3600,
      },
      String(sa.private_key),
      { algorithm: 'RS256' },
    )
  } catch (e) {
    return { ok: false, motiv: `cheia contului de serviciu nu semnează: ${String((e as Error)?.message ?? e).slice(0, 80)}` }
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: semnat }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string }
    if (!r.ok || !j.access_token) {
      return { ok: false, motiv: `Google a refuzat tokenul (${r.status}): ${String(j.error_description ?? '').slice(0, 100)}` }
    }
    return { ok: true, token: j.access_token, proiect: String(sa.project_id) }
  } catch (e) {
    return { ok: false, motiv: `rețea la token: ${String((e as Error)?.message ?? e).slice(0, 80)}` }
  }
}

/** Cheltuiala + creditele REALE din exportul BigQuery, pe ultimele `zile` zile.
 *  Orice treaptă lipsă → motiv cu pasul exact care mai e de făcut în consolă. */
export async function facturareGoogle(
  zile = 60,
): Promise<{ ok: true; date: FacturareGoogle } | { ok: false; motiv: string }> {
  if (cache && Date.now() - cache.la < CACHE_MS) return cache.rezultat
  const t = await tokenBigQuery()
  if (!t.ok) return t
  const tabel = `\`${t.proiect}.${DATASET}.${tabelExport()}\``
  // Creditele din export sunt NEGATIVE (scad costul) → le întoarcem pozitive.
  const sql =
    `SELECT IFNULL(SUM(cost),0) AS cheltuit, ` +
    `IFNULL(-SUM((SELECT IFNULL(SUM(c.amount),0) FROM UNNEST(credits) c)),0) AS credite, ` +
    `CAST(MIN(usage_start_time) AS STRING) AS din ` +
    `FROM ${tabel} WHERE usage_start_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${Math.max(1, Math.floor(zile))} DAY)`
  try {
    const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${t.proiect}/queries`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 15_000 }),
      signal: AbortSignal.timeout(20_000),
    })
    const j = (await r.json().catch(() => ({}))) as {
      rows?: { f?: { v?: string }[] }[]
      error?: { message?: string }
    }
    if (!r.ok) {
      const msg = String(j.error?.message ?? '').slice(0, 160)
      const pas = /Not found: (Dataset|Table)/i.test(msg)
        ? ' — pasul rămas ÎN CONSOLĂ: Billing → Billing export → BigQuery export → Enable (dataset „' + DATASET + '")'
        : /permission|denied|403/i.test(`${r.status} ${msg}`)
          ? ' — pasul rămas ÎN CONSOLĂ: dă contului de serviciu rolul Billing Account Viewer + BigQuery Data Viewer pe dataset'
          : ''
      return { ok: false, motiv: `BigQuery ${r.status}: ${msg}${pas}` }
    }
    const f = j.rows?.[0]?.f
    const date: FacturareGoogle = {
      cheltuitUsd: Number(f?.[0]?.v ?? 0),
      crediteUsd: Number(f?.[1]?.v ?? 0),
      dinData: String(f?.[2]?.v ?? '').slice(0, 10),
    }
    const rezultat = { ok: true as const, date }
    cache = { la: Date.now(), rezultat }
    return rezultat
  } catch (e) {
    return { ok: false, motiv: `rețea la BigQuery: ${String((e as Error)?.message ?? e).slice(0, 80)}` }
  }
}
