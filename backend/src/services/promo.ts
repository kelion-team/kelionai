// ── THE PROMO CLIP — the preparation, in ONE SINGLE source (chat + voice) ─
// §1 "what typing can do, the voice can do too": `prepare_promo_clip` was the
// LAST capability asleep on the voice (out of 38). The logic lived inline in
// chat.ts, so the voice had no way to use it. Here once, called by both
// routes (the permanent principle: unique, no duplicates).
//
// The result is "the client's shape": ChatPanel arms the Rec button from the
// {promo} frame (armPromo), and the scenes must be {at,title,url,close} —
// NOT the raw {at_seconds,kind,query} shape (QA 24 Jul: otherwise all timers
// came out NaN and the map/weather scenes were left without a URL).
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

/** Validates + builds the promo clip. `error` = refusal reason, otherwise payload. */
export async function buildPromo(
  args: Record<string, unknown>,
): Promise<{ error: string } | { promo: PromoPayload; monitorUrl: string | null }> {
  const subject = String(args.subject ?? '')
  const duration = Number(args.duration_seconds ?? 30)
  const script = String(args.script ?? '')
  const lang = String(args.lang ?? 'ro-RO')
  const scenes = Array.isArray(args.scenes) ? args.scenes : []
  if (!subject || !script) return { error: 'missing_params' }
  // Image scenes must come from generate_image (own URL), not from the web.
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
    } else clientScenes.push({ at, title, close: true }) // avatar → clear screen
  }
  return {
    promo: { subject, duration, script, lang, scenes: clientScenes },
    monitorUrl: await promoSceneUrl('map', subject),
  }
}
