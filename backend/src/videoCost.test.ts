import { describe, it, expect } from 'vitest'
import {
  PRET_VIDEO_USD_PE_SECUNDA,
  costVideoUsd,
  secundeVideoValide,
  motivRefuzVideo,
  gasesteUriVideo,
} from './services/video.js'

// ── GARDA DE BANI A VIDEOULUI (2 aug 2026) ──────────────────────────────────
// Veo NU are nivel gratuit (măsurat pe pagina oficială de prețuri) — deci
// generarea trebuie să refuze STRUCTURAL fără alegerea conștientă a ownerului
// (VIDEO_ALLOW_PAID=1), exact ca garda constructorului. Testele de aici țin
// acea gardă sub lacăt: prețurile vin din listă (nu inventate), refuzul spune
// prețul, iar un model necunoscut nu primește niciodată un preț ghicit.

describe('prețul din lista oficială', () => {
  it('cele 3 modele Veo 3.1 vizibile cu cheia (models.list) au preț', () => {
    expect(PRET_VIDEO_USD_PE_SECUNDA['veo-3.1-generate-preview']).toBe(0.4)
    expect(PRET_VIDEO_USD_PE_SECUNDA['veo-3.1-fast-generate-preview']).toBe(0.1)
    expect(PRET_VIDEO_USD_PE_SECUNDA['veo-3.1-lite-generate-preview']).toBe(0.05)
  })

  it('costul = preț pe secundă × secunde, rotunjit la cent', () => {
    expect(costVideoUsd('veo-3.1-fast-generate-preview', 8)).toBe(0.8)
    expect(costVideoUsd('veo-3.1-lite-generate-preview', 6)).toBe(0.3)
    expect(costVideoUsd('veo-3.1-generate-preview', 4)).toBe(1.6)
  })

  it('model necunoscut ⇒ null, nu un preț inventat', () => {
    expect(costVideoUsd('veo-99-inexistent', 8)).toBeNull()
  })
})

describe('secundele permise de Veo 3.1 (4/6/8)', () => {
  it('cererea se duce la cea mai apropiată valoare permisă', () => {
    expect(secundeVideoValide(3)).toBe(4)
    expect(secundeVideoValide(5)).toBe(4)
    expect(secundeVideoValide(6)).toBe(6)
    expect(secundeVideoValide(7)).toBe(6)
    expect(secundeVideoValide(8)).toBe(8)
    expect(secundeVideoValide(120)).toBe(8)
    expect(secundeVideoValide(NaN)).toBe(8)
  })
})

describe('garda structurală de plată', () => {
  const model = 'veo-3.1-fast-generate-preview'

  it('fără cheie Gemini ⇒ refuz cu motivul cheii', () => {
    expect(motivRefuzVideo({ cheie: '', allowPaid: true, model })).toBe('fara_cheie_gemini')
  })

  it('fără VIDEO_ALLOW_PAID ⇒ refuz care SPUNE prețul măsurat', () => {
    const r = motivRefuzVideo({ cheie: 'k', allowPaid: false, model })
    expect(r).toMatch(/video_platit_neaprobat/)
    expect(r).toMatch(/\$0\.80/)
    expect(r).toMatch(/VIDEO_ALLOW_PAID=1/)
  })

  it('model fără preț cunoscut ⇒ refuz chiar și cu plata aprobată', () => {
    expect(motivRefuzVideo({ cheie: 'k', allowPaid: true, model: 'veo-necunoscut' })).toMatch(/model_fara_pret_cunoscut/)
  })

  it('cheie + aprobare conștientă + model cu preț ⇒ drum liber', () => {
    expect(motivRefuzVideo({ cheie: 'k', allowPaid: true, model })).toBeNull()
  })
})

describe('găsirea URI-ului video în răspunsul operației', () => {
  it('forma cunoscută generateVideoResponse.generatedSamples', () => {
    const r = { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://x/files/abc' } }] } }
    expect(gasesteUriVideo(r)).toBe('https://x/files/abc')
  })

  it('forma cunoscută generatedVideos', () => {
    const r = { generatedVideos: [{ video: { uri: 'https://x/files/def' } }] }
    expect(gasesteUriVideo(r)).toBe('https://x/files/def')
  })

  it('plasa defensivă găsește un URL de fișier oriunde în răspuns', () => {
    const r = { alt: { drum: [{ adanc: 'https://api/x/files/ghi:download' }] } }
    expect(gasesteUriVideo(r)).toBe('https://api/x/files/ghi:download')
  })

  it('răspuns fără video ⇒ null (se raportează sincer, nu se declară succes)', () => {
    expect(gasesteUriVideo({ doar: 'text', numar: 3 })).toBeNull()
    expect(gasesteUriVideo(null)).toBeNull()
  })
})
