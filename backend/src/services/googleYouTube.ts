// ── YOUTUBE UPLOAD (owner, 14 aug — bifat în lista de aplicații) ─────────────
//
// PARTICULARITATEA măsurată chiar azi pe pielea noastră: scope-ul
// youtube.upload NU poate sta în ACEEAȘI cerere de consimțământ cu drive.file
// (refuzul „scopes that cannot be requested together" i-a blocat ownerului
// toată conectarea). De-aia YouTube are POARTA LUI: /auth/google/connect-youtube
// cere DOAR youtube.upload, cu include_granted_scopes=true — consimțământul
// vechi rămâne, tokenul nou le acoperă pe toate (autorizare incrementală,
// calea documentată de Google).
//
// Unealta urcă un clip DEJA EXISTENT în aplicație (generat cu Veo sau adus) —
// id-ul din /api/video/<id>. Implicit PRIVATE (nimic nu devine public fără
// decizia omului); titlul/descrierea vin de la creier, din vorbele omului.
// Regula #1: fiecare treaptă picată → motivul exact, inclusiv „lipsește
// consimțământul YouTube — trimite omul la /auth/google/connect-youtube".

import { getVideo } from './video.js'

export async function youtubeUrca(
  token: string,
  videoId: string,
  titlu: string,
  descriere: string,
): Promise<string> {
  if (!token) return JSON.stringify({ error: 'fara_token_google', motiv: 'contul Google nu e conectat' })
  if (!videoId) return JSON.stringify({ error: 'fara_video', motiv: 'dă-mi id-ul clipului (din /api/video/<id>)' })
  const v = await getVideo(videoId.replace(/^.*\/api\/video\//, ''))
  if (!v) return JSON.stringify({ error: 'video_negasit', motiv: `nu există niciun clip cu id-ul „${videoId}" în aplicație` })

  // Multipart simplu (clipurile Veo de 4-8s au câțiva MB — sub orice prag).
  const granita = `kelion-${Date.now()}`
  const meta = JSON.stringify({
    snippet: { title: (titlu || 'Clip Kelionai').slice(0, 100), description: (descriere || '').slice(0, 4500) },
    // PRIVATE implicit — publicarea e o decizie a omului, în contul lui.
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
  })
  const cap = Buffer.from(
    `--${granita}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${granita}\r\nContent-Type: ${v.mime || 'video/mp4'}\r\n\r\n`,
    'utf8',
  )
  const coada = Buffer.from(`\r\n--${granita}--\r\n`, 'utf8')
  try {
    const r = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${granita}`,
        },
        body: Buffer.concat([cap, v.buf, coada]),
        signal: AbortSignal.timeout(120_000),
      },
    )
    if (!r.ok) {
      const detaliu = (await r.text().catch(() => '')).slice(0, 250)
      return JSON.stringify({
        error: `youtube_http_${r.status}`,
        motiv:
          r.status === 403 || /insufficient/i.test(detaliu)
            ? 'consimțământul YouTube lipsește — trimite omul o singură dată la /auth/google/connect-youtube (poarta separată; nu poate sta lângă Drive în aceeași cerere)'
            : detaliu,
      })
    }
    const j = (await r.json()) as { id?: string }
    if (!j.id) return JSON.stringify({ error: 'youtube_fara_id' })
    return JSON.stringify({
      ok: true,
      videoId: j.id,
      url: `https://youtube.com/watch?v=${j.id}`,
      vizibilitate: 'private',
      indicatie: 'Clipul e urcat PRIVAT în contul omului — spune-i linkul și că îl poate face public din YouTube Studio când vrea el.',
    })
  } catch (e) {
    return JSON.stringify({ error: 'youtube_retea', motiv: String((e as Error)?.message ?? e).slice(0, 120) })
  }
}
