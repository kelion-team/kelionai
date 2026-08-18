import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  PRET_VIDEO_USD_PE_SECUNDA,
  costVideoUsd,
  secundeVideoValide,
  motivRefuzVideo,
  gasesteUriVideo,
  verdictVideoPlatit,
} from './services/video.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

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

  it('fără aprobare ⇒ refuz care SPUNE prețul măsurat și DRUMUL (butonul din panou)', () => {
    const r = motivRefuzVideo({ cheie: 'k', allowPaid: false, model })
    expect(r).toMatch(/video_platit_neaprobat/)
    expect(r).toMatch(/\$0\.80/)
    // P29 + lecția de la 20:58 („tu ai zis sa opresc… iti bati joc de mine?"):
    // numele vechi «Video plătit» îl împingea pe owner să-l OPREASCĂ atunci
    // când voia video. Drumul spus e butonul, PE NUMELE LUI REAL, și adevărul
    // întreg: la Veo nu există gratis; gratis = doar Google Flow.
    expect(r).toMatch(/«🎬 Generarea de clipuri \(Veo\)» → «Pornește generarea»/)
    expect(r).toMatch(/nu există „gratis" la Veo; gratis = doar Google Flow/)
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

// ── P29: DRUMUL BANILOR LA VIDEO (owner, 15 aug: „eu vreau sa platesc, sau
// clientul, de ce nu ma duce spre plata" + „daca video si funtiile nu merg e
// pa") — comutatorul e buton (kv), clientul plătit trece, cel fără sold e DUS
// la credite, iar refuzul dă mereu și calea gratuită (Google Flow). ──────────
describe('P29 — comutatorul „video plătit": kv (butonul) bate env-ul', () => {
  it('kv „1"/„0" = alegerea de pe buton, indiferent de env', () => {
    expect(verdictVideoPlatit('1', false)).toEqual({ pornit: true, sursa: 'buton' })
    expect(verdictVideoPlatit('0', true)).toEqual({ pornit: false, sursa: 'buton' })
  })

  it('fără kv cade pe env; nimic setat = OPRIT (nimic plătit din greșeală)', () => {
    expect(verdictVideoPlatit(null, true)).toEqual({ pornit: true, sursa: 'env' })
    expect(verdictVideoPlatit(null, false)).toEqual({ pornit: false, sursa: 'implicit' })
  })

  it('clientul care a PLĂTIT tariful trece de comutator (clipul e autofinanțat)', () => {
    const video = sursa('./services/video.ts')
    expect(video).toMatch(/allowPaid: comutator\.pornit \|\| platitDeClient/)
    const chat = sursa('./routes/chat.ts')
    // 21:29 („nu mai bine il faci sa genereze? nu ma mai umple de butoane"):
    // cererea explicită a ADMINULUI e aprobarea — generarea pornește direct;
    // comutatorul 🎬 rămâne doar peste timerul nesupravegheat.
    expect(chat).toMatch(/genereazaVideo\(prompt, Number\(args\.seconds \?\? 8\), taxa\.scazutGbp > 0 \|\| isAdmin, \(sec\) => \{/)
  })

  it('lecția 21:26 — fiecare încercare lasă verdictul în kv, iar panoul îl arată', () => {
    const video = sursa('./services/video.ts')
    expect(video).toMatch(/KV_VIDEO_ULTIMA = 'video_ultima_incercare'/)
    expect(video).toMatch(/noteazaIncercarea\(`REUȘIT: clip \$\{secunde\}s/)
    const admin = sursa('./routes/admin.ts')
    expect(admin).toMatch(/videoUltimaIncercare/)
    const panou = sursa('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).toMatch(/Ultima încercare de clip/)
  })
})

describe('P29 — omul e DUS spre plată, nu lăsat în fundătură', () => {
  it('sold insuficient ⇒ pagina de credite se deschide pe monitor + pasul spus creierului', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/monitor: \{ url: '\/credite', title: 'Credits' \}/)
    expect(chat).toMatch(/Pagina de credite e DEJA pe monitorul lui/)
  })

  it('refuzul „video plătit neaprobat" dă calea GRATUITĂ (Google Flow), cu pași', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/alternativa_gratuita/)
    expect(chat).toMatch(/labs\.google\/flow/)
  })

  it('butonul de admin există, e gardat de cerAdmin și lasă urmă în audit (P26)', () => {
    const admin = sursa('./routes/admin.ts')
    expect(admin).toMatch(/app\.post<\{ Body: \{ pornit\?: boolean \} \}>\('\/api\/admin\/video-platit'[\s\S]{0,160}?cerAdmin\(req, reply\)/)
    expect(admin).toMatch(/noteazaAudit\('admin', 'video-platit \(buton\)'/)
    const panou = sursa('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).toMatch(/Timerul de promovare POATE genera singur/)
    expect(panou).toMatch(/onVideoPlatit/)
  })

  it('lecția 20:58 + 21:29 — cererea generează DIRECT; butonul a rămas doar peste timer', () => {
    const panou = sursa('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).toMatch(/Clipurile CERUTE \(de tine sau de clienți plătiți\) se generează DIRECT — fără butoane\./)
    expect(panou).toMatch(/Permite timerului să genereze/)
    expect(panou).toMatch(/gratis la Veo nu există/)
    expect(panou).toMatch(/~0,10 \$\/secundă/)
  })

  it('lecția 21:20 („nu afiseaza nimic pe ecran") — ecranul NU tace cât se generează', () => {
    const chat = sursa('./routes/chat.ts')
    // pasul pornește PE LOC, bătaia de inimă la 5s cu secundele, finalul închide bara
    expect(chat).toMatch(/Generez clipul la Google \(durează 1-3 minute\)/)
    expect(chat).toMatch(/Clipul se generează la Google… \$\{sec\}s/)
    expect(chat).toMatch(/Clipul e gata — îl pun pe monitor/)
    expect(chat).toMatch(/Generarea NU a pornit — motivul, mai jos/)
    const video = sursa('./services/video.ts')
    expect(video).toMatch(/onPas\?: \(secundeScurse: number\) => void/)
    expect(video).toMatch(/onPas\?\.\(Math\.round\(\(Date\.now\(\) - start\) \/ 1000\)\)/)
  })
})
