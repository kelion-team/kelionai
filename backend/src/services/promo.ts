// ── CLIPUL PROMO — pregătirea, într-o SINGURĂ sursă (chat + voce) ─────────────
// §1 „ce poate scrisul, poate și vocea": `prepare_promo_clip` era ULTIMA
// capabilitate adormită pe voce (din 38). Logica trăia inline în chat.ts, deci
// vocea n-avea cum s-o folosească. Aici o dată, chemată de ambele rute
// (principiul permanent: unic, fără duplicate).
//
// Rezultatul e „forma clientului": ChatPanel armează butonul Rec din cadrul
// {promo} (armPromo), iar scenele trebuie să fie {at,title,url,close} — NU forma
// brută {at_seconds,kind,query} (QA 24 iul: altfel toate timerele ieșeau NaN și
// scenele map/weather rămâneau fără URL).
import { promoSceneUrl } from './google.js'

export interface PromoScene {
  at: number
  title: string
  url?: string
  close?: boolean
}

export interface PromoPayload {
  subject: string
  duration: number
  script: string
  lang: string
  scenes: PromoScene[]
}

/** Validează + construiește clipul promo. `error` = motiv de refuz, altfel payload. */
export async function buildPromo(
  args: Record<string, unknown>,
): Promise<{ error: string } | { promo: PromoPayload; monitorUrl: string | null }> {
  const subject = String(args.subject ?? '')
  const duration = Number(args.duration_seconds ?? 30)
  const script = String(args.script ?? '')
  const lang = String(args.lang ?? 'ro-RO')
  const scenes = Array.isArray(args.scenes) ? args.scenes : []
  if (!subject || !script) return { error: 'missing_params' }
  // Scenele-imagine trebuie să vină din generate_image (URL propriu), nu din web.
  for (const s of scenes) {
    const scene = s as { kind?: string; url?: string }
    if (scene.kind === 'image' && !scene.url?.startsWith('/api/image/')) {
      return { error: 'image_scene_needs_api_image_url' }
    }
  }
  const clientScenes: PromoScene[] = []
  for (const raw of scenes) {
    const s = raw as { at_seconds?: number; kind?: string; query?: string; url?: string; title?: string }
    const at = Math.max(0, Number(s.at_seconds ?? 0))
    const title = String(s.title ?? s.query ?? subject)
    if (s.kind === 'image' && s.url) clientScenes.push({ at, title, url: s.url })
    else if (s.kind === 'map' || s.kind === 'weather') {
      const u = await promoSceneUrl(s.kind, String(s.query ?? subject))
      if (u) clientScenes.push({ at, title, url: u })
    } else clientScenes.push({ at, title, close: true }) // avatar → ecran liber
  }
  return {
    promo: { subject, duration, script, lang, scenes: clientScenes },
    monitorUrl: await promoSceneUrl('map', subject),
  }
}
