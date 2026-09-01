// ── P30a: OCHIUL VIDEO — lacăte (15 aug 2026) ────────────────────────────────
// (owner, verbatim: „kelion trebuie sa aibe o abilitate sa vada un videoclip
// din youtube, tiktok sau de oriunde… sa extraga ideile principale si
// informatiile din clip, sa le catalogheze si sa le invete"; planul feliat
// aprobat cu „propune" → „start")
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eLinkYoutube, VEDE_VIDEO_MAX_S, fisaCaText } from './services/vedeVideo.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('P30a — recunoașterea linkurilor (felia YouTube)', () => {
  it('formele reale de YouTube se recunosc', () => {
    expect(eLinkYoutube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(eLinkYoutube('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(eLinkYoutube('https://youtube.com/shorts/abc12345')).toBe(true)
  })

  it('REPARAT (audit 15 aug): formele autentice pe care regexul vechi le refuza FALS', () => {
    // m.youtube.com = forma standard copiată din browserul telefonului —
    // exact cum testează ownerul live; refuzul ei era un neadevăr spus omului.
    expect(eLinkYoutube('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(eLinkYoutube('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(eLinkYoutube('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true)
    expect(eLinkYoutube('https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ')).toBe(true)
  })

  it('gazdele-capcană NU trec (parsare de URL, nu potrivire de substring)', () => {
    expect(eLinkYoutube('https://youtube.com.evil.tld/watch?v=dQw4w9WgXcQ')).toBe(false)
    expect(eLinkYoutube('https://evil.tld/youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
    expect(eLinkYoutube('ftp://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
  })

  it('ce NU e YouTube se refuză cinstit (TikTok = felia P30b, nu tăcere)', () => {
    expect(eLinkYoutube('https://www.tiktok.com/@cineva/video/123')).toBe(false)
    expect(eLinkYoutube('https://vimeo.com/12345')).toBe(false)
    expect(eLinkYoutube('')).toBe(false)
    const svc = sursa('./services/vedeVideo.ts')
    expect(svc).toMatch(/link_nesuportat_inca/)
  })
})

describe('P30a — onestitate prin construcție', () => {
  it('plafonul de durată există și taie transcriptul înainte de analiză', () => {
    expect(VEDE_VIDEO_MAX_S).toBeGreaterThanOrEqual(60)
    const svc = sursa('./services/vedeVideo.ts')
    expect(svc).toMatch(/second > VEDE_VIDEO_MAX_S/)
  })

  it('fișa fără idei = eroare numită; costul și tokenii vin din Responses', () => {
    const svc = sursa('./services/vedeVideo.ts')
    expect(svc).toMatch(/fișa nu se inventează/)
    expect(svc).toMatch(/response\.inputTokens \+ response\.outputTokens/)
    expect(svc).toMatch(/costUsd: response\.costUsd/)
  })

  it('fișa ca text poartă sursa și ideile (formatul pe care îl vede omul)', () => {
    const t = fisaCaText('https://youtu.be/x', {
      titlu: 'Test', idei: ['ideea 1'], informatii: ['fapt 1'],
      momente: [{ la: '1:02', ce: 'moment' }], ton: 'calm', tokeni: 10, costUsd: 0, plafonAtins: false,
    })
    expect(t).toContain('Sursa: https://youtu.be/x')
    expect(t).toContain('IDEI PRINCIPALE')
    expect(t).toContain('1:02 — moment')
  })
})

describe('P30a — cataloghează și învață (lanțul întreg, pe cod)', () => {
  it('unealta vede_video există în inventarul creierului și în cazul din runTool', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/name: 'vede_video'/)
    expect(chat).toMatch(/case 'vede_video': \{/)
  })

  it('fișa intră în videoteca migrată, în memoria userului și în jurnalul de cost', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/salveazaVideoInvatat\(email, url, fisa\.titlu/)
    expect(chat).toMatch(/learnFromTurn\(email, `\[a cerut să văd clipul\] \$\{url\}`/)
    expect(chat).toMatch(/recordCost\(email, 'video-vazut'/)
    const db = sursa('./db.ts')
    const schema = sursa('../migrations/20260824_base_schema.sql')
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS video_invatat/)
    expect(db).not.toMatch(/CREATE TABLE|ALTER TABLE/)
    expect(db).toMatch(/noteazaAudit\(cerutDe, 'video-vazut \(catalogat\)'/)
    expect(db).toContain('DELETE FROM video_invatat WHERE lower(cerut_de) = $1')
  })

  it('videoteca e căutabilă („din ce clipuri știi X?")', () => {
    const db = sursa('./db.ts')
    expect(db).toMatch(/export async function cautaVideoInvatat/)
    expect(db).toMatch(/titlu ILIKE '%' \|\| \$1 \|\| '%' OR fisa ILIKE/)
  })
})
