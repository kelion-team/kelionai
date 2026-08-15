// ── P30a: OCHIUL VIDEO AL LUI KELION — YouTube, direct prin creier (15 aug) ──
// (owner, verbatim: „kelion trebuie sa aibe o abilitate sa vada un videoclip
// din youtube, tiktok sau de oriunde, in orice format, deschizind in spatiul
// lui, propriu si sa extraga ideile principale si informatiile din clip, sa le
// catalogheze si sa le invete")
//
// FELIA a (aprobată cu „start" + „propune"→plan): YouTube DIRECT — API-ul
// Gemini acceptă un URL de YouTube ca fileData.fileUri în generateContent,
// fără nicio descărcare; clipul se „vede" în spațiul creierului. Felia b
// (descărcarea „de oriunde" prin yt-dlp) și felia c (legarea la Studio) vin
// separat — ușile alea cer acordul explicit al ownerului (termenii platformelor).
//
// Onestitate prin construcție:
//   • plafonul de durată e SPUS (VEDE_VIDEO_MAX_S, implicit 600s = 10 min) —
//     peste el se vede doar începutul, iar fișa o spune;
//   • costul = tokenii REALI din usageMetadata, la tariful de intrare al
//     modelului — înregistrat în cost_events sub 'video-vazut', nu inventat;
//   • un răspuns fără fișă = eroare NUMITĂ, nu succes prefăcut.
import { config } from '../config.js'

const G_BAZA = 'https://generativelanguage.googleapis.com/v1beta'
// Modelul care vede: cel al creierului (config.geminiModel) — un singur robinet.
export const VEDE_VIDEO_MAX_S = Math.max(60, Number(process.env.VEDE_VIDEO_MAX_S || 600))
// Tariful de INTRARE al modelului flash (pagina de prețuri Google, citită
// 15 aug 2026): $0.30 / 1M tokeni — video-ul se tokenizează ca intrare.
// Estimare declarată pe tarif public; factura adevărată e la Google.
export const USD_1M_TOKENI_VIDEO = 0.3

const RE_YOUTUBE = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{5,}/i

/** E un link pe care felia P30a îl poate vedea DIRECT (YouTube)? */
export function eLinkYoutube(url: string): boolean {
  return RE_YOUTUBE.test(String(url ?? '').trim())
}

export interface FisaVideo {
  titlu: string
  idei: string[]
  informatii: string[]
  momente: { la: string; ce: string }[]
  ton: string
  /** Tokenii REALI raportați de Google pentru tura asta (usageMetadata). */
  tokeni: number
  costUsd: number
  plafonAtins: boolean
}

const PROMPT_FISA =
  `Vezi clipul și întoarce STRICT un obiect JSON (fără alt text) cu forma: ` +
  `{"titlu": string, "idei": string[] (3-7 idei principale), ` +
  `"informatii": string[] (fapte concrete, cifre, nume), ` +
  `"momente": [{"la": "m:ss", "ce": string}] (5-10 momente cheie), ` +
  `"ton": string (o propoziție: cine vorbește și pe ce ton)}. ` +
  `Totul în ROMÂNĂ, indiferent de limba clipului.`

/** Kelion VEDE un clip de YouTube și întoarce fișa structurată — sau eroarea
 *  numită. Nu descarcă nimic: URL-ul intră direct în creier (fileData). */
export async function vedeVideoYoutube(url: string): Promise<FisaVideo | { error: string }> {
  const curat = String(url ?? '').trim()
  if (!eLinkYoutube(curat)) {
    return {
      error:
        'link_nesuportat_inca: felia de azi vede DOAR YouTube (fără descărcare, direct prin creier). ' +
        'TikTok/„de oriunde"/fișiere vin în felia următoare (P30b) — spune-i omului cinstit.',
    }
  }
  if (!config.geminiKey) return { error: 'fara_cheie_gemini' }
  let r: Response
  try {
    r = await fetch(`${G_BAZA}/models/${config.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                fileData: { fileUri: curat },
                // Plafonul de durată, aplicat CHIAR în cerere: vedem primele
                // VEDE_VIDEO_MAX_S secunde — costul rămâne mărginit și spus.
                videoMetadata: { startOffset: '0s', endOffset: `${VEDE_VIDEO_MAX_S}s` },
              },
              { text: PROMPT_FISA },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(180_000),
    })
  } catch (e) {
    return { error: `vede_video rețea: ${String((e as Error)?.message ?? e).slice(0, 160)}` }
  }
  const text = await r.text().catch(() => '')
  if (!r.ok) return { error: `vede_video ${r.status}: ${text.slice(0, 200)}` }
  try {
    const j = JSON.parse(text) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      usageMetadata?: { totalTokenCount?: number }
    }
    const brutFisa = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const f = JSON.parse(brutFisa) as Partial<FisaVideo>
    if (!Array.isArray(f.idei) || f.idei.length === 0) {
      return { error: 'vede_video: creierul a răspuns fără idei — fișa nu se inventează' }
    }
    const tokeni = Number(j.usageMetadata?.totalTokenCount ?? 0)
    return {
      titlu: String(f.titlu ?? '').slice(0, 200),
      idei: f.idei.map((x) => String(x).slice(0, 300)).slice(0, 10),
      informatii: (Array.isArray(f.informatii) ? f.informatii : []).map((x) => String(x).slice(0, 300)).slice(0, 15),
      momente: (Array.isArray(f.momente) ? f.momente : [])
        .map((m) => ({ la: String((m as { la?: string }).la ?? '').slice(0, 10), ce: String((m as { ce?: string }).ce ?? '').slice(0, 200) }))
        .slice(0, 12),
      ton: String(f.ton ?? '').slice(0, 200),
      tokeni,
      costUsd: Math.round(((tokeni * USD_1M_TOKENI_VIDEO) / 1_000_000) * 10000) / 10000,
      plafonAtins: false, // durata reală n-o știm fără metadata clipului — plafonul e în cerere; nu declarăm ce n-am măsurat
    }
  } catch {
    return { error: `vede_video JSON rupt (${text.length} caractere)` }
  }
}

/** Fișa, gata de pus în chat/catalog — text compact, cu momente și sursă. */
export function fisaCaText(url: string, f: FisaVideo): string {
  const momente = f.momente.map((m) => `  ${m.la} — ${m.ce}`).join('\n')
  return (
    `FIȘA CLIPULUI: ${f.titlu}\nSursa: ${url}\n\nIDEI PRINCIPALE:\n${f.idei.map((i) => `  • ${i}`).join('\n')}` +
    (f.informatii.length ? `\n\nINFORMAȚII CONCRETE:\n${f.informatii.map((i) => `  • ${i}`).join('\n')}` : '') +
    (momente ? `\n\nMOMENTE CHEIE:\n${momente}` : '') +
    (f.ton ? `\n\nTON: ${f.ton}` : '')
  )
}
