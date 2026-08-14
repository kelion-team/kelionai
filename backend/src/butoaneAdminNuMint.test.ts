import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { citesteRaspunsRunbook } from './services/runbooks.js'

// ── UN BUTON CARE NU A FĂCUT NIMIC NU MAI SPUNE „SUCCES" (8 aug 2026) ───────
//
// Adrian: „tot ce e în admin trebuie probat și să facă, real" + „cu dovezi
// măsurate". Am pornit aplicația local, cu mediul curățat de credențiale, și am
// lovit toate cele 57 de rute care scriu. Ce a ieșit, măsurat:
//
//     POST /api/admin/reset-vps        →  200 {"ok":true}
//     POST /api/admin/reset-counters   →  200 {"ok":false,"sterse":0}
//
// Primul: ruta chema `runRunbook('restart-app')` și `runRunbook('restart-caddy')`
// și le ARUNCA răspunsul. `runRunbook` întorsese `{"error":"github_token_missing"}`
// — deci nu plecase nicio comandă — iar panoul scria „Comanda de resetare VPS a
// fost trimisă cu succes." Același lucru s-ar fi întâmplat cu autonomia pusă pe
// pauză („paused_by_owner") sau cu un dispatch refuzat de GitHub.
//
// Al doilea: ștergerea picată răspundea 200, iar panoul se uita DOAR la statusul
// HTTP — deci scria „Resetat ✓" peste niște contoare neatinse.
//
// A patra și a cincea oară aceeași familie, după „£0.00", „Cardul: necreat" și
// „0 creați, 0 eșuați": o operație REFUZATĂ prezentată ca fapt împlinit.
//
// Testele de mai jos rulează pe ȘIRURILE PE CARE LE ÎNTOARCE CHIAR `runRunbook`
// (copiate din codul lui, nu inventate), ca reparația să fie probată, nu doar
// scrisă.

const src = (p: string): string => fs.readFileSync(new URL(`./${p}`, import.meta.url), 'utf8')

describe('citirea răspunsului unui runbook — refuzul se NUMEȘTE', () => {
  it('fără GITHUB_TOKEN: NU e „pornit", și motivul ajunge întreg la om', () => {
    const brut = JSON.stringify({
      error: 'github_token_missing',
      hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env și repornește containerul (redeploy).',
    })
    const pas = citesteRaspunsRunbook('restart-app', brut)
    expect(pas.ok, 'un runbook refuzat raportat ca reușit — exact bugul reparat').toBe(false)
    expect(pas.detaliu).toContain('github_token_missing')
    expect(pas.detaliu, 'omul trebuie să afle CE are de făcut, nu doar că „n-a mers"').toContain('GITHUB_TOKEN în')
  })

  it('autonomia pe pauză: tot refuz, nu succes tăcut', () => {
    const brut = JSON.stringify({
      error: 'paused_by_owner',
      hint: 'Adrian a oprit autonomia („pauza-autonomie"); se reia doar cu „reia-autonomia" de la el',
    })
    expect(citesteRaspunsRunbook('restart-app', brut).ok).toBe(false)
  })

  it('GitHub refuză dispatch-ul: statusul refuzului apare în motiv', () => {
    const pas = citesteRaspunsRunbook('restart-caddy', JSON.stringify({ error: 'dispatch_failed_403', detail: 'nope' }))
    expect(pas.ok).toBe(false)
    expect(pas.detaliu).toContain('dispatch_failed_403')
  })

  it('dispatch reușit (200 de la GitHub): ăsta e singurul caz de „pornit"', () => {
    const brut = JSON.stringify({
      ok: true,
      started: 'restart-app',
      watch: 'https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml',
      hint: 'rularea apare în câteva secunde; rezultatul se citește din jurnalul ei',
    })
    const pas = citesteRaspunsRunbook('restart-app', brut)
    expect(pas.ok).toBe(true)
    expect(pas.detaliu).toBe('pornit')
  })

  it('reușită, dar cu BUCLĂ: rămâne reușită și cară avertismentul mai departe', () => {
    const pas = citesteRaspunsRunbook('restart-app', JSON.stringify({ ok: true, warning: 'BUCLĂ: ultimele 2 rulări au PICAT.' }))
    expect(pas.ok).toBe(true)
    expect(pas.detaliu, 'avertismentul dispărea și omul repeta la nesfârșit aceeași soluție').toContain('BUCLĂ')
  })

  it('răspuns care nu e JSON: NU se ia drept succes', () => {
    const pas = citesteRaspunsRunbook('restart-app', '<html>502 Bad Gateway</html>')
    expect(pas.ok, 'un răspuns neinteligibil trecut ca reușit e fix minciuna pe care o vânăm').toBe(false)
    expect(pas.detaliu).toContain('raspuns_neinteligibil')
  })
})

// ── GARDURILE PE RUTE ────────────────────────────────────────────────────────
// Verdictul e probat mai sus pe cifre; aici se ține DRUMUL: ruta chiar citește
// pașii și chiar dă un status de eșec. Fără gardul ăsta, cineva poate reintroduce
// `return { ok: true }` fără să pice nimic.

describe('rutele care scriu nu mai răspund 2xx peste un eșec', () => {
  const admin = src('routes/admin.ts')
  const voiceprint = src('routes/voiceprint.ts')
  const tranzactii = src('routes/tranzactii.ts')

  /** Corpul unei rute, decupat din sursă.
   *
   *  PRIMA VARIANTĂ CĂUTA ȘIRUL ADRESEI — și l-a găsit unde nu trebuia: în
   *  `routes/tranzactii.ts` adresa apare ÎNTÂI în pagina HTML pe care o
   *  servește fișierul (un `fetch('/api/tranzactii/analiza')` scris în
   *  template), abia pe urmă în ruta reală. Deci testul citea pagina, nu
   *  handlerul, și pica pe cod corect. Al treilea gard de-al meu care se
   *  înșală (după cel tăiat la cuvântul „break" din comentariu) — de-aia acum
   *  se cere ÎNREGISTRAREA rutei, nu adresa singură. */
  const handler = (sursa: string, metoda: string, cale: string): string => {
    const inregistrare = new RegExp(`app\\.${metoda}\\s*(?:<[\\s\\S]{0,3000}?>)?\\s*\\(\\s*'${cale}'`)
    const m = inregistrare.exec(sursa)
    expect(m, `n-am găsit înregistrarea ${metoda.toUpperCase()} ${cale} — testul s-ar fi făcut că verifică`).toBeTruthy()
    // Până la începutul următoarei rute înregistrate, ca să nu citim din vecin.
    const rest = sursa.slice((m as RegExpExecArray).index + (m as RegExpExecArray)[0].length)
    const pana = rest.search(/\n {2}app\.(get|post|put|patch|delete)\b/)
    return pana === -1 ? rest : rest.slice(0, pana)
  }

  it('reset-vps citește rezultatul fiecărui runbook și dă 502 dacă n-a pornit', () => {
    const h = handler(admin, 'post', '/api/admin/reset-vps')
    expect(/citesteRaspunsRunbook/.test(h), 'răspunsul runbook-ului e aruncat din nou').toBe(true)
    expect(/reply\.code\(502\)/.test(h), 'un refuz care iese cu 2xx repune bugul la loc').toBe(true)
    expect(/pasi/.test(h), 'răspunsul nu poartă pașii, deci panoul n-are ce motiv să arate').toBe(true)
  })

  it('reset-counters dă 502 când ștergerea n-a avut loc', () => {
    const h = handler(admin, 'post', '/api/admin/reset-counters')
    expect(/if \(!r\.ok\)/.test(h), 'rezultatul ștergerii nu mai e verificat').toBe(true)
    expect(/reply\.code\(502\)/.test(h)).toBe(true)
  })

  it('ștergerea amprentei e ÎNCHISĂ de tot (ordinul din 14 aug: se păstrează) — refuz 403, nu 2xx', () => {
    // Contractul vechi (502 la DELETE picat, 8 aug) e ÎNLOCUIT de ordinul mai
    // nou al ownerului: „amprentele vocale trebuie să se păstreze" — ruta nu
    // mai șterge nimic, niciodată; răspunde 403 cu motivul, tot ne-2xx.
    const h = handler(voiceprint, 'delete', '/api/voiceprint/me')
    expect(/reply\.code\(403\)/.test(h), 'refuzul trebuie să fie explicit, cu status de refuz').toBe(true)
    expect(/amprentele_se_pastreaza/.test(h), 'motivul ordinului trebuie să fie în răspuns').toBe(true)
  })

  it('analiza de piață nu mai întoarce 200 cu {error}', () => {
    const h = handler(tranzactii, 'post', '/api/tranzactii/analiza')
    expect(/reply\.code\(502\)/.test(h), 'piața necitibilă / agentul mut ieșeau cu 200').toBe(true)
    expect(/reply\.code\(503\)/.test(h), 'agentul lipsă din roster ieșea cu 200').toBe(true)
  })
})
