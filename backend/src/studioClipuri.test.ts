// ── P22: STUDIOUL DE CLIPURI — lacăte (owner, 15 aug, verbatim: „ii dai o
// ideie, ii spui foloseste studioul de clipuri si el face tot" + „cu functie
// timer de promovare eventual la ore prestabilite" + „orice clip se salveaza
// cu nume sugestiv data ora" + „in download" + „prin google flow" + „fiecare
// user logat poate sa le foloseasca")
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  RETETE_STUDIO, numeClip, promptVideoDinIdee, planStudio,
  setariPromoDinKv, motivRefuzPromo,
} from './services/studioClipuri.js'
import { UNELTE_VORBIRE } from './services/fazeChat.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('P22 — numele sugestiv cu data și ora (ordinul verbatim)', () => {
  it('numele poartă rețeta, subiectul, data și ora — fără diacritice stricate', () => {
    const n = numeClip('Spot publicitar', 'Kelionai, asistentul tău', new Date(2026, 7, 15, 9, 5))
    expect(n).toBe('Spot-publicitar-Kelionai-asistentul-tau-2026-08-15_09-05')
  })

  it('subiect gol/murdar nu naște nume gol', () => {
    expect(numeClip('Clip', '###', new Date(2026, 0, 1, 0, 0))).toMatch(/^Clip-Clip-2026-01-01_00-00$/)
  })
})

describe('P22 — planul studioului: gratis (Google Flow) și plătit (Veo)', () => {
  it('cele 6 rețete ale ownerului există', () => {
    expect(RETETE_STUDIO).toHaveLength(6)
    expect(RETETE_STUDIO).toContain('Spot publicitar')
    expect(RETETE_STUDIO).toContain('Clip bilingv')
  })

  it('fără idee ⇒ refuz care CERE ideea (nu plan inventat)', () => {
    expect(planStudio('', undefined, 'gratis', new Date())).toEqual({ error: expect.stringContaining('fara_idee') })
  })

  it('calea GRATIS: prompt de lipit în Flow + pașii omului + numele de Download', () => {
    const p = planStudio('un cățel pe plajă', 'Clip din idee', 'gratis', new Date(2026, 7, 15, 12, 0))
    if ('error' in p) throw new Error('planul nu avea voie să refuze')
    expect(p.promptFlow).toContain('un cățel pe plajă')
    expect(p.pasi.join(' ')).toContain('labs.google/flow')
    expect(p.pasi.join(' ')).toContain('Download')
    expect(p.numeFisier).toMatch(/\.mp4$/)
  })

  it('calea PLĂTITĂ: prețul din lista_tarife + confirmare EXPLICITĂ înainte de bani', () => {
    const p = planStudio('spot pentru brutărie', 'Spot publicitar', 'platit', new Date())
    if ('error' in p) throw new Error('planul nu avea voie să refuze')
    expect(p.pasi[0]).toContain('lista_tarife')
    expect(p.pasi[1]).toContain('confirmarea EXPLICITĂ')
    expect(p.promptVeo).toContain('spot pentru brutărie')
  })

  it('promptul șlefuit poartă stilul rețetei, nu inventează subiectul', () => {
    const t = promptVideoDinIdee('idee simplă', 'Tutorial')
    expect(t).toContain('idee simplă')
    expect(t).toContain('clean screen-style presentation')
  })
})

describe('P22 — unealta e la creier, pentru ORICE user logat, și pe faza de vorbire', () => {
  it('studioul_de_clipuri există în chat.ts, în ambele liste, cu cazul lui', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/name: 'studioul_de_clipuri'/)
    expect(chat).toMatch(/case 'studioul_de_clipuri': \{/)
    expect((chat.match(/STUDIO_TOOL/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(UNELTE_VORBIRE).toContain('studioul_de_clipuri')
  })

  it('meniul ▦ Aplicații poartă Studioul (a înlocuit vechiul Generator video)', () => {
    const stage = sursa('../../frontend/src/pages/Stage.tsx')
    expect(stage).toMatch(/🎬 Studioul de Clipuri/)
    expect(stage).not.toMatch(/🎬 Generator video/)
  })

  it('cardul video de pe monitor SALVEAZĂ în Download cu numele sugestiv (titlul cardului)', () => {
    const stage = sursa('../../frontend/src/pages/Stage.tsx')
    expect(stage).toMatch(/download=\{numeFisier\}/)
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/const numeVideo = numeClip\('Clip', prompt, new Date\(\)\)/)
    expect(chat).toMatch(/nume_fisier: `\$\{numeVideo\}\.mp4`/)
  })
})

describe('P22 — timerul de promovare: TOATE cheile sunt ale ownerului', () => {
  const setari = { pornit: true, ore: [9, 18], plafonUsdZi: 2, idee: 'Kelion pe kelionai.app' }
  const liber = {
    setari, oraAcum: 9, dejaRulatOraAsta: false, videoPornit: true,
    cheltuitAziUsd: 0, costClipUsd: 0.8,
  }

  it('kv gol/stricat = OPRIT (implicit sigur, nu pornit din greșeală)', () => {
    expect(setariPromoDinKv(null).pornit).toBe(false)
    expect(setariPromoDinKv('{stricat').pornit).toBe(false)
    expect(setariPromoDinKv(JSON.stringify({ pornit: true, ore: [9, 77, -1], plafonUsdZi: 2, idee: 'x' })).ore).toEqual([9])
  })

  it('drum liber DOAR cu toate cheile: pornit + oră + comutator video + plafon', () => {
    expect(motivRefuzPromo(liber)).toBeNull()
  })

  it('fiecare cheie lipsă refuză PE NUME', () => {
    expect(motivRefuzPromo({ ...liber, setari: { ...setari, pornit: false } })).toMatch(/promo_oprit/)
    expect(motivRefuzPromo({ ...liber, setari: { ...setari, idee: ' ' } })).toMatch(/promo_fara_idee/)
    expect(motivRefuzPromo({ ...liber, oraAcum: 10 })).toMatch(/ora_neprogramata/)
    expect(motivRefuzPromo({ ...liber, dejaRulatOraAsta: true })).toMatch(/deja_rulat_ora_asta/)
    expect(motivRefuzPromo({ ...liber, videoPornit: false })).toMatch(/generarea_video_oprita/)
    expect(motivRefuzPromo({ ...liber, costClipUsd: null })).toMatch(/model_fara_pret_cunoscut/)
    expect(motivRefuzPromo({ ...liber, cheltuitAziUsd: 1.5 })).toMatch(/plafon_atins/)
  })

  it('timerul e legat la server (bucla de 5 min) și setările au ruta de admin cu audit', () => {
    const index = sursa('./index.ts')
    expect(index).toMatch(/promoTick/)
    const admin = sursa('./routes/admin.ts')
    expect(admin).toMatch(/\/api\/admin\/studio-promo/)
    expect(admin).toMatch(/noteazaAudit\('admin', 'studio-promo \(setări timer\)'/)
    const panou = sursa('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).toMatch(/function PromoStudio/)
  })

  it('pe necitit nu se cheltuie: tick-ul refuză când costul de azi nu se poate citi', () => {
    const timer = sursa('./services/promoTimer.ts')
    expect(timer).toMatch(/cost_azi_necitibil — pe necitit nu se cheltuie \(regula #1\)/)
  })
})

// ── P32 (owner, 15 aug 21:44, verbatim: „dupa ce genereaza scenariul genul
// asta trebuie sa ai selectare de copiere si sa apesi pe butonul din aplicatii
// de generare video, se preia textul automat si incepe generarea, se salveaza
// in download, pe ecran bargraful spune statusul de generare reala dinamica"
// + 21:42: „trebuie sa apara la text generare sau reparare sa sti ce face") ──
describe('P32 — scenariul se preia AUTOMAT; bara spune pe românește ce face', () => {
  it('studioul trimite frame-ul {scenariu} către client (textul + numele + calea)', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/scenariu: \{ text: scenariu, nume: plan\.numeFisier, cale: plan\.cale \}/)
    const tip = sursa('../../frontend/src/lib/chat.ts')
    expect(tip).toMatch(/scenariu\?: \{ text: string; nume: string; cale: string \}/)
  })

  it('clientul îl ține minte (localStorage) și butonul 🎬 îl PREIA automat', () => {
    const panou = sursa('../../frontend/src/components/ChatPanel.tsx')
    expect(panou).toMatch(/localStorage\.setItem\('kelion_scenariu'/)
    const stage = sursa('../../frontend/src/pages/Stage.tsx')
    expect(stage).toMatch(/Generează ACUM clipul video cu exact acest scenariu/)
    expect(stage).toMatch(/📋 Copiază scenariul pregătit/)
    // prospețimea: un scenariu de acum 3 zile nu mai sare singur în meniu
    expect(stage).toMatch(/30 \* 60 \* 1000/)
  })

  it('bara de execuție spune întâi CE FACE (românește), numele tehnic în paranteză', () => {
    const chat = sursa('./routes/chat.ts')
    expect(chat).toMatch(/`\$\{capabilitate\.does\} \(\$\{name\}\)`/)
    const cap = sursa('./services/brainCapabilities.ts')
    expect(cap).toMatch(/GENERARE VIDEO: face clipul cerut/)
  })

  it('creierul NU mai deleagă generarea de clipuri agenților (captura 21:42: cheama_agent pe o cerere de clip)', () => {
    const defs = sursa('./services/brainToolDefs.ts')
    expect(defs).toMatch(/NU delega NICIODATĂ generarea de clipuri sau imagini/)
  })
})
