// ── GOOGLE PHOTOS, prin Picker API (owner, 14 aug — bifat în lista de
// aplicații; „toate aplicațiile trebuiesc") ──────────────────────────────────
//
// DE CE Picker și nu vechiul Library API: Google a ȘTERS scope-ul
// photoslibrary.readonly pe 31 mar 2025 (măsurat live, 2 aug — 403 chiar cu
// scope-ul „acordat"). Calea OFICIALĂ rămasă: Picker API — aplicația deschide
// o SESIUNE de ales, omul își alege pozele în interfața Google (pe telefonul
// sau browserul lui), iar aplicația citește DOAR ce a ales el. Confidențial
// prin construcție: Kelion nu vede biblioteca, vede alegerea.
//
// Fluxul pe unelte:
//   1. photos_alege → creează sesiunea → întoarce pickerUri (linkul unde omul
//      alege) — Kelion îl pune pe monitor și îi spune omului să aleagă.
//   2. photos_adu → verifică sesiunea; când omul a terminat de ales
//      (mediaItemsSet), descarcă pozele alese (max 6) cu tokenul lui, le
//      salvează în stocul de imagini al aplicației (generated_images) și le
//      arată pe monitor prin /api/image/<id> — același drum ca imaginile
//      generate, nimic nou de întreținut.
//
// Regula #1 peste tot: fiecare treaptă picată întoarce motivul exact
// (sesiune inexistentă, omul n-a ales încă, poza nu s-a putut descărca) —
// niciodată un „gata" neacoperit.

import crypto from 'node:crypto'
import { saveGeneratedImage } from '../db.js'

const BAZA = 'https://photospicker.googleapis.com/v1'

interface SesiunePicker {
  id?: string
  pickerUri?: string
  mediaItemsSet?: boolean
  pollingConfig?: { pollInterval?: string }
}

/** Sesiunile pornite, per user — ținem doar ultima (un om alege o dată). */
const sesiuni = new Map<string, { id: string; pickerUri: string; la: number }>()

export async function photosAlege(email: string, token: string): Promise<string> {
  if (!token) return JSON.stringify({ error: 'fara_token_google', motiv: 'contul Google nu e conectat — conectează-l întâi' })
  try {
    const r = await fetch(`${BAZA}/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) {
      const detaliu = (await r.text().catch(() => '')).slice(0, 200)
      // 403 = scope-ul Photos nu e acordat încă → omul se re-conectează o dată.
      return JSON.stringify({
        error: `photos_sessions_http_${r.status}`,
        motiv: r.status === 403
          ? 'accesul la Google Photos nu e acordat încă — omul trebuie să se RE-conecteze la Google o dată (apare permisiunea nouă)'
          : detaliu,
      })
    }
    const j = (await r.json()) as SesiunePicker
    if (!j.id || !j.pickerUri) return JSON.stringify({ error: 'photos_fara_sesiune' })
    sesiuni.set(email.toLowerCase(), { id: j.id, pickerUri: j.pickerUri, la: Date.now() })
    return JSON.stringify({
      ok: true,
      pickerUri: j.pickerUri,
      indicatie:
        'Deschide linkul (pune-l pe monitor cu show_on_screen) — omul își alege pozele în interfața Google, apoi tu chemi photos_adu ca să le aduci.',
    })
  } catch (e) {
    return JSON.stringify({ error: 'photos_retea', motiv: String((e as Error)?.message ?? e).slice(0, 120) })
  }
}

export async function photosAdu(email: string, token: string, baseUrl: string): Promise<string> {
  const s = sesiuni.get(email.toLowerCase())
  if (!s) return JSON.stringify({ error: 'fara_sesiune', motiv: 'nu există o alegere pornită — cheamă întâi photos_alege' })
  if (!token) return JSON.stringify({ error: 'fara_token_google' })
  try {
    const st = await fetch(`${BAZA}/sessions/${encodeURIComponent(s.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!st.ok) return JSON.stringify({ error: `photos_sesiune_http_${st.status}` })
    const sj = (await st.json()) as SesiunePicker
    if (!sj.mediaItemsSet) {
      return JSON.stringify({ inca_alege: true, motiv: 'omul nu a terminat de ales — mai așteaptă și încearcă iar' })
    }
    const li = await fetch(`${BAZA}/mediaItems?sessionId=${encodeURIComponent(s.id)}&pageSize=6`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!li.ok) return JSON.stringify({ error: `photos_lista_http_${li.status}` })
    const lj = (await li.json()) as {
      mediaItems?: { mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string } }[]
    }
    const alese = (lj.mediaItems ?? []).slice(0, 6)
    if (!alese.length) return JSON.stringify({ error: 'nimic_ales', motiv: 'sesiunea s-a închis fără nicio poză aleasă' })
    const aduse: { url: string; nume: string }[] = []
    const esuate: string[] = []
    for (const m of alese) {
      const bu = m.mediaFile?.baseUrl
      if (!bu) continue
      try {
        // baseUrl cere parametri de mărime; =d aduce originalul (cu token!).
        const img = await fetch(`${bu}=w1600-h1600`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        })
        if (!img.ok) {
          esuate.push(m.mediaFile?.filename ?? 'poza')
          continue
        }
        const buf = Buffer.from(await img.arrayBuffer())
        const id = crypto.randomBytes(16).toString('hex')
        await saveGeneratedImage(id, m.mediaFile?.mimeType ?? 'image/jpeg', buf)
        aduse.push({ url: `${baseUrl}/api/image/${id}`, nume: m.mediaFile?.filename ?? 'poza' })
      } catch {
        esuate.push(m.mediaFile?.filename ?? 'poza')
      }
    }
    sesiuni.delete(email.toLowerCase())
    if (!aduse.length) return JSON.stringify({ error: 'descarcarea_a_picat', esuate })
    return JSON.stringify({
      ok: true,
      poze: aduse,
      esuate: esuate.length ? esuate : undefined,
      indicatie: 'Arată-le pe monitor (show_on_screen cu url-ul fiecăreia) și spune-i omului ce ai adus.',
    })
  } catch (e) {
    return JSON.stringify({ error: 'photos_retea', motiv: String((e as Error)?.message ?? e).slice(0, 120) })
  }
}
