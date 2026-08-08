import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { saveGeneratedImage, loadGeneratedImage } from '../db.js'

// ── VIDEO GENERAT — Veo prin cheia Gemini (2 aug 2026) ──────────────────────
// MĂSURAT ÎNTÂI (regula 1), apoi construit:
//   • models.list cu cheia REALĂ de pe VPS (jurnal vps-run 30771855145) vede
//     veo-3.1-generate-preview / -fast / -lite și imagen-4.0* — deci cheia
//     AJUNGE la modele.
//   • pagina oficială de prețuri (ai.google.dev/gemini-api/docs/pricing,
//     citită 2 aug 2026): Veo NU are NICIUN nivel gratuit. Prețul e pe
//     secunda de video generat — tabelul de mai jos e copia acelei pagini,
//     nu o estimare a noastră.
// De-aia generarea refuză STRUCTURAL fără VIDEO_ALLOW_PAID=1 — exact tiparul
// constructorului (CONSTRUCTOR_ALLOW_PAID): nimic plătit din greșeală,
// niciodată; plata e o alegere conștientă a ownerului, scrisă în env.
//
// Ce E gratuit la Google (aceeași pagină): generarea de IMAGINI pe modelele
// Gemini Flash (free tier). Imaginile noastre merg pe cheia Gemini
// (services/image.ts → geminiImage) — rămân acolo.

/** USD pe secunda de video, la 720p — copiat din pagina oficială de prețuri
 *  (2 aug 2026). Modele necunoscute NU primesc un preț inventat: cost null →
 *  generarea refuză, nu „estimează". */
export const PRET_VIDEO_USD_PE_SECUNDA: Record<string, number> = {
  'veo-3.1-generate-preview': 0.4,
  'veo-3.1-fast-generate-preview': 0.1,
  'veo-3.1-lite-generate-preview': 0.05,
}

/** Veo 3.1 acceptă doar 4, 6 sau 8 secunde — cererea se duce la cea mai
 *  apropiată valoare permisă, nu pică pe o cifră liberă. */
export function secundeVideoValide(cerute: number): 4 | 6 | 8 {
  const s = Number.isFinite(cerute) ? cerute : 8
  if (s <= 5) return 4
  if (s <= 7) return 6
  return 8
}

/** Costul ÎNTREGII generări, din lista oficială. null = model fără preț
 *  cunoscut (refuzăm, nu ghicim). */
export function costVideoUsd(model: string, secunde: number): number | null {
  const peSecunda = PRET_VIDEO_USD_PE_SECUNDA[model]
  if (peSecunda === undefined) return null
  return Math.round(peSecunda * secunde * 100) / 100
}

/** De ce NU se poate genera acum — sau null dacă drumul e liber.
 *  Mesajul e pentru creier: spune omului exact ce lipsește și cât costă. */
export function motivRefuzVideo(
  opts: { cheie: string; allowPaid: boolean; model: string } = {
    cheie: config.geminiKey,
    allowPaid: config.videoAllowPaid,
    model: config.videoModel,
  },
): string | null {
  if (!opts.cheie) return 'fara_cheie_gemini'
  const cost = costVideoUsd(opts.model, 8)
  if (cost === null) return `model_fara_pret_cunoscut:${opts.model}`
  if (!opts.allowPaid)
    return (
      `video_platit_neaprobat: Veo nu are nivel gratuit (măsurat pe pagina de prețuri Google, 2 aug 2026); ` +
      `modelul ${opts.model} costă ~$${cost.toFixed(2)} pe un clip de 8s. ` +
      `Pornirea e o alegere conștientă a ownerului: VIDEO_ALLOW_PAID=1 în env.`
    )
  return null
}

/** Caută URI-ul fișierului video în răspunsul operației — întâi pe cele două
 *  forme cunoscute ale API-ului, apoi printr-o căutare defensivă. null =
 *  spunem sincer că nu l-am găsit (cu cheile de sus ale răspunsului), nu
 *  declarăm succes nemăsurat. */
export function gasesteUriVideo(raspuns: unknown): string | null {
  const r = raspuns as Record<string, any> | null
  const cunoscute = [
    r?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri,
    r?.generatedVideos?.[0]?.video?.uri,
    r?.generateVideoResponse?.generatedVideos?.[0]?.video?.uri,
  ]
  for (const u of cunoscute) if (typeof u === 'string' && u.startsWith('http')) return u
  // Plasa: primul string care arată a fișier video servit de API.
  const stiva: unknown[] = [raspuns]
  while (stiva.length) {
    const cur = stiva.pop()
    if (typeof cur === 'string') {
      if (cur.startsWith('http') && (/\/files\//.test(cur) || cur.endsWith('.mp4'))) return cur
    } else if (cur && typeof cur === 'object') {
      for (const v of Object.values(cur as Record<string, unknown>)) stiva.push(v)
    }
  }
  return null
}

interface StoredVideo {
  mime: string
  buf: Buffer
}

// Cache mic SEPARAT de al imaginilor: un clip are megaocteți, nu zeci de
// kiloocteți — 3 clipuri în memorie ajung, restul se recitesc din DB.
const cache = new Map<string, StoredVideo>()
const MAX_CACHE = 3

export async function getVideo(id: string): Promise<StoredVideo | null> {
  const hit = cache.get(id)
  if (hit) return hit
  // Depozitul e tabela generică de media generată (generated_images ține
  // id+mime+bytes, nu știe de format) — un rând video stă lângă imagini.
  const row = await loadGeneratedImage(id)
  if (!row) return null
  const v = { mime: row.mime, buf: row.data }
  cache.set(id, v)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return v
}

export type VideoResult =
  | { id: string; mime: string; costUsd: number; secunde: number; model: string }
  | { error: string }

const BAZA = 'https://generativelanguage.googleapis.com/v1beta'

/** Generarea propriu-zisă: pornește operația long-running, așteaptă până la
 *  5 minute, descarcă fișierul și îl pune în depozit. Orice pas picat se
 *  întoarce ca eroare cu locul exact — niciun „a mers" nemăsurat. */
export async function genereazaVideo(prompt: string, secundeCerute = 8): Promise<VideoResult> {
  const p = prompt.trim()
  if (!p) return { error: 'empty_prompt' }
  const refuz = motivRefuzVideo()
  if (refuz) return { error: refuz }

  const model = config.videoModel
  const secunde = secundeVideoValide(secundeCerute)
  const cost = costVideoUsd(model, secunde)
  if (cost === null) return { error: `model_fara_pret_cunoscut:${model}` }

  let opName = ''
  try {
    const r = await fetch(`${BAZA}/models/${model}:predictLongRunning?key=${config.geminiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt: p }], parameters: { durationSeconds: secunde, aspectRatio: '16:9' } }),
    })
    if (!r.ok) return { error: `pornire_generare:${r.status}:${(await r.text()).slice(0, 300)}` }
    const j = (await r.json()) as { name?: string }
    if (!j.name) return { error: 'pornire_generare:fara_nume_operatie' }
    opName = j.name
  } catch (e) {
    return { error: `pornire_generare:${String(e).slice(0, 200)}` }
  }

  // Așteptarea: Veo termină de obicei în 1-3 minute; tavanul e 5, ca un clip
  // blocat să nu țină tura de chat ostatică la nesfârșit.
  const pana = Date.now() + 5 * 60 * 1000
  let raspuns: unknown = null
  while (Date.now() < pana) {
    await new Promise((res) => setTimeout(res, 5000))
    try {
      const r = await fetch(`${BAZA}/${opName}?key=${config.geminiKey}`)
      if (!r.ok) continue
      const j = (await r.json()) as { done?: boolean; error?: { message?: string }; response?: unknown }
      if (j.error?.message) return { error: `generare:${String(j.error.message).slice(0, 300)}` }
      if (j.done) {
        raspuns = j.response ?? null
        break
      }
    } catch {
      // un poll picat nu omoară așteptarea — următorul poate reuși
    }
  }
  if (raspuns === null) return { error: 'generare:timeout_5min (operația poate continua la Google, dar nu am ce arăta)' }

  const uri = gasesteUriVideo(raspuns)
  if (!uri) {
    const chei = raspuns && typeof raspuns === 'object' ? Object.keys(raspuns as object).join(',') : typeof raspuns
    return { error: `raspuns_fara_video (chei: ${chei})` }
  }

  try {
    const sep = uri.includes('?') ? '&' : '?'
    const r = await fetch(`${uri}${sep}key=${config.geminiKey}`)
    if (!r.ok) return { error: `descarcare:${r.status}` }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) return { error: 'descarcare:fisier_gol' }
    const mime = r.headers.get('content-type')?.split(';')[0] || 'video/mp4'
    const id = randomUUID()
    await saveGeneratedImage(id, mime, buf)
    cache.set(id, { mime, buf })
    return { id, mime, costUsd: cost, secunde, model }
  } catch (e) {
    return { error: `descarcare:${String(e).slice(0, 200)}` }
  }
}
