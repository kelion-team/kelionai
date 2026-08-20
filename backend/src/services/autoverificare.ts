// ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug) ──────────────────────────────
// „ceva inteligent bazat pe AI" care verifică singur că Kelion FACE toate
// funcțiile — și, când nu merge, spune și DE CE („verifică și de ce nu merge"),
// cu recomandare fermă. Kelion se testează pe el însuși, măsurat, nu presupus.
//
// SURSA e registrul UNIC de capabilități (brainCapabilities.CAPABILITIES) — nu o
// listă scrisă de mână; o funcție nouă apare aici singură.
//
// SIGURANȚA (banii + producția, owner): funcțiile de CITIRE se probează REAL
// (execuție); funcțiile cu EFECT (build, email, ștergere, plată) NU se execută
// orb — se verifică doar CABLAJUL + dependența, fără efect/cost. Verdictul e
// MĂSURAT (regula #1): „nu pot verifica" cinstit, niciodată „merge" fabricat.
//
// Nucleul (tipFunctie + interpreteazaProba) e PUR și probat; execuția reală și
// diagnosticul AI vin ca dependențe injectate (testabil, fără rețea în teste).

import { CAPABILITIES, grupaExecutieUnealta, type Capability } from './brainCapabilities.js'

export type VerdictFunctie = 'merge' | 'stricat' | 'nu_pot_verifica'
export type TipFunctie = 'citire' | 'efect'

export interface RezultatProba {
  ok: boolean
  rezultat?: string // ce a întors real (scurt)
  eroare?: string // motivul erorii, dacă a picat
}

export interface VerificareFunctie {
  functie: string
  categorie: string
  face: string
  tip: TipFunctie
  verdict: VerdictFunctie
  deCe: string // MĂSURAT — mai ales DE CE nu merge
  recomandare: string // fermă (doar când nu merge)
  dovada: string // ce a întors real, scurt
}

export interface RaportAutoverificare {
  total: number
  merg: number
  stricate: number
  nepotverifica: number
  functii: VerificareFunctie[]
}

/** Citire (probă reală sigură) vs efect (dry-run, fără efect). Sursa: registrul
 *  de execuție paralelă (grupaExecutieUnealta: undefined = citire independentă). */
export function tipFunctie(nume: string): TipFunctie {
  return grupaExecutieUnealta(nume) === undefined ? 'citire' : 'efect'
}

/** PURĂ: din rezultatul MĂSURAT al unei probe → verdict + DE CE + recomandare
 *  fermă. Aici stă inteligența deterministă: clasifică eroarea în cauză reală
 *  (auth / lipsă cheie / rețea / serviciu jos / cablaj), nu doar „nu merge". */
export function interpreteazaProba(
  functie: string,
  tip: TipFunctie,
  p: RezultatProba,
): { verdict: VerdictFunctie; deCe: string; recomandare: string } {
  const e = String(p.eroare ?? '').toLowerCase()
  const r = String(p.rezultat ?? '')

  // ── FUNCȚIE CU EFECT: la test NU se execută (nu ardem bani / nu facem acțiuni).
  // Verificăm doar cablajul — p.ok = e înregistrată + dispecerul o știe.
  if (tip === 'efect') {
    if (p.ok)
      // NU „merge" (audit fake, 20 aug): un efect NErulat nu e verificat — știu
      // doar că e CABLAT (garantat la build de lacătul de paritate), NU că efectul
      // chiar se produce. Rule #1: neverificat ≠ merge → „nu pot verifica".
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'cablată (garantat la build de lacătul de paritate), dar NU o rulez la test — ar produce efect/cost; deci nu pot verifica LIVE că efectul chiar se produce',
        recomandare: 'verificare live doar la o rulare reală, cerută explicit (ex. un email de probă, o imagine de test)',
      }
    return {
      verdict: 'stricat',
      deCe: p.eroare || 'funcția nu e înregistrată / dispecerul n-o cunoaște',
      recomandare: 'REPARĂ cablajul: adaug-o în registru + în dispecerul de unelte, apoi re-verifică.',
    }
  }

  // ── FUNCȚIE DE CITIRE: probată REAL. Clasificăm rezultatul măsurat.
  if (p.eroare) {
    // PROBĂ INDISPONIBILĂ PE ACEASTĂ CALE: unealta EXISTĂ, dar se execută pe calea
    // CHAT (executorul din chat.ts), nu prin dispecerul de probă (`uneltele`) —
    // deci n-o pot atinge de aici. NU e „stricată", NU e „handler lipsă / nu produce
    // nimic" (exact eticheta greșită pe care a pus-o Kelion pe 22 de citiri).
    if (/unealt[ăa] necunoscut/.test(e))
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'se execută pe calea chat, nu prin dispecerul de probă — n-o pot atinge de aici (NU e stricată)',
        recomandare: 'Probeaz-o direct din chat (ex. „cât e ceasul", o căutare) ca s-o confirmi.',
      }
    // AUTH: nu e stricat, e lipsă de sesiune/drepturi — onest „nu pot verifica".
    if (/\b401\b|\b403\b|unauthorized|forbidden|autentific|sesiun|nu ești admin/.test(e))
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'cere autentificare/drepturi (nu se poate proba fără sesiunea reală)',
        recomandare: 'Verifică logat, din chat; nu e o stricăciune de cod.',
      }
    // CREDENȚIALE lipsă (Google/Serper/cheie): nu merge, dar cauza e clară.
    if (/token|refresh|no.?credential|api.?key|cheie|serper|google.*(auth|token)|reconnect|neconectat/.test(e))
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'lipsește cheia/tokenul necesar (ex. Google/Serper) — nu e stricat codul, e configurarea',
        recomandare: 'FERM: reconectează contul / pune cheia lipsă, apoi re-verifică.',
      }
    // ARGUMENT LIPSĂ/INVALID: unealta cere o INTRARE reală (query, id, text) — nu
    // se poate proba corect cu argumente goale. Onest „nu pot verifica", NU „stricat"
    // (altfel o unealtă perfect funcțională apare roșu doar fiindcă am probat-o gol).
    if (/\brequired\b|is required|missing (required )?(parameter|argument|field|query|id)|lipse[șs]te.*(argument|parametru|c[âa]mp|intrarea|query|textul|\bid\b)|argument(e|ul)?\s*(lips|invalid|gol|obligatoriu)|obligatoriu|invalid input|invalid arguments|expected .*(argument|parameter)|f[ăa]r[ăa] (query|argument|intrare|text)|trebuie.{0,15}(id|query|text|argument|parametru|intrare|c[âa]mp|valoare)/.test(e))
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'cere o intrare reală (nu se poate proba corect cu argumente goale)',
        recomandare: 'Probează cu o intrare reală (o căutare, un id, un text) din chat — nu e o stricăciune.',
      }
    // REȚEA / SERVICIU JOS: chiar nu merge acum.
    if (/econnrefused|econnreset|etimedout|timeout|network|fetch failed|getaddrinfo|\b5\d\d\b|service unavailable|not respond|nu r[ăa]spunde/.test(e))
      return {
        verdict: 'stricat',
        deCe: `serviciul nu răspunde (rețea/timeout): ${p.eroare?.slice(0, 120)}`,
        recomandare: 'FERM: verifică serviciul din spate (e jos/încet); re-probează după ce revine.',
      }
    // BINAR/FIȘIER lipsă:
    if (/enoent|not found|command not found|no such file/.test(e))
      return {
        verdict: 'stricat',
        deCe: `lipsește un binar/fișier necesar: ${p.eroare?.slice(0, 120)}`,
        recomandare: 'FERM: instalează/repune dependența lipsă pe host, apoi re-verifică.',
      }
    // Altă eroare — reală, de reparat.
    return {
      verdict: 'stricat',
      deCe: `a picat: ${p.eroare?.slice(0, 140)}`,
      recomandare: 'FERM: deschide funcția din cod pe cauza din motiv și repar-o.',
    }
  }

  // Fără eroare, dar rezultat gol / auto-declarat eșec → nu pot confirma (regula #1).
  if (!r.trim() || /\berror\b|e[șs]uat|nu pot|imposibil|\bfail\b/i.test(r))
    return {
      verdict: 'nu_pot_verifica',
      deCe: r.trim() ? `rezultat neconcludent: ${r.slice(0, 120)}` : 'rezultat gol — nimic măsurabil întors',
      recomandare: 'Re-probează cu o intrare reală; dacă rămâne gol, funcția nu produce nimic.',
    }

  // Rezultat plauzibil → MERGE (probat real).
  return { verdict: 'merge', deCe: 'probat real — a întors un rezultat valid', recomandare: '' }
}

export interface DepsAutoverificare {
  /** Probează o funcție de CITIRE, real (execuție). */
  probaCitire: (c: Capability) => Promise<RezultatProba>
  /** Cablajul unei funcții cu EFECT: e înregistrată + dispecerul o știe? */
  esteCablat: (c: Capability) => Promise<boolean> | boolean
  /** (opțional) Diagnostic AI: îmbogățește „de ce nu merge" pe funcțiile picate,
   *  cu cauză + recomandare mai deșteaptă. Primește lista de picate, întoarce
   *  o hartă nume→{deCe, recomandare}. Dacă lipsește / cade, rămâne diagnosticul
   *  determinist (regula #1: nu inventăm). */
  creierDiag?: (
    picate: { functie: string; face: string; deCe: string }[],
  ) => Promise<Record<string, { deCe?: string; recomandare?: string }>>
}

/** Rulează autoverificarea pe TOATE capabilitățile din registru. */
export async function ruleazaAutoverificare(deps: DepsAutoverificare): Promise<RaportAutoverificare> {
  const functii: VerificareFunctie[] = []
  for (const c of CAPABILITIES) {
    const tip = tipFunctie(c.name)
    let proba: RezultatProba
    try {
      proba = tip === 'citire' ? await deps.probaCitire(c) : { ok: !!(await deps.esteCablat(c)) }
    } catch (err) {
      proba = { ok: false, eroare: String((err as Error)?.message ?? err).slice(0, 200) }
    }
    const { verdict, deCe, recomandare } = interpreteazaProba(c.name, tip, proba)
    functii.push({
      functie: c.name,
      categorie: c.category,
      face: c.does,
      tip,
      verdict,
      deCe,
      recomandare,
      dovada: (proba.rezultat ?? proba.eroare ?? '').slice(0, 200),
    })
  }

  // ── DIAGNOSTIC AI (inteligent) pe cele care NU merg — îmbogățește „de ce".
  const picate = functii.filter((f) => f.verdict !== 'merge')
  if (deps.creierDiag && picate.length) {
    try {
      const harta = await deps.creierDiag(picate.map((f) => ({ functie: f.functie, face: f.face, deCe: f.deCe })))
      for (const f of picate) {
        const d = harta?.[f.functie]
        if (d?.deCe) f.deCe = `${f.deCe} · AI: ${d.deCe}`.slice(0, 400)
        if (d?.recomandare) f.recomandare = d.recomandare.slice(0, 300) || f.recomandare
      }
    } catch {
      /* creierul jos → rămâne diagnosticul determinist (regula #1) */
    }
  }

  return {
    total: functii.length,
    merg: functii.filter((f) => f.verdict === 'merge').length,
    stricate: functii.filter((f) => f.verdict === 'stricat').length,
    nepotverifica: functii.filter((f) => f.verdict === 'nu_pot_verifica').length,
    functii,
  }
}

// ── MĂSURĂTORILE DECIZIONALE (owner, 19 aug: „implementează-i măsurătorile
// decizionale… să nu se mai repete") ────────────────────────────────────────
// Recurența pe care o repară: Kelion a lipit CAUZE și REPARAȚII pe care nu le-a
// măsurat (publish n-a rulat / model empty / fișier lipsă). Funcția asta e
// antidotul STRUCTURAL: primește DOAR verdictele MĂSURATE și derivă din ele
// acțiunea — deci nu POATE inventa o cauză. Ce nu are o cauză clară de cod devine
// „măsoară întâi" (cu măsurătoarea exactă numită), nu o reparație oarbă.
export type ActiuneDecizie = 'repara' | 'reconfigureaza' | 'masoara_intai'
export interface DecizieMasurata {
  functie: string
  actiune: ActiuneDecizie
  urmatoareaMasuratoare: string // pasul concret, DERIVAT din cauza măsurată
  deCe: string // verdictul/cauza MĂSURATĂ (niciodată inventată)
}
export function decideDinMasuratori(functii: VerificareFunctie[]): DecizieMasurata[] {
  const out: DecizieMasurata[] = []
  for (const f of functii) {
    if (f.verdict === 'merge') continue
    const c = f.deCe.toLowerCase()
    if (f.verdict === 'nu_pot_verifica') {
      if (/calea chat/.test(c))
        out.push({ functie: f.functie, actiune: 'masoara_intai', urmatoareaMasuratoare: 'probeaz-o direct din chat (ea merge pe calea chat) — proba din dispecer n-o atinge', deCe: f.deCe })
      else if (/autentificare|drepturi|sesiun/.test(c))
        out.push({ functie: f.functie, actiune: 'masoara_intai', urmatoareaMasuratoare: 're-probează logat, din sesiunea reală — NU e cod de reparat', deCe: f.deCe })
      else if (/cheie|token|configurare|reconect|neconectat/.test(c))
        out.push({ functie: f.functie, actiune: 'reconfigureaza', urmatoareaMasuratoare: 'pune cheia lipsă / reconectează contul, apoi re-probează', deCe: f.deCe })
      else
        out.push({ functie: f.functie, actiune: 'masoara_intai', urmatoareaMasuratoare: 're-probează cu o intrare reală (query/id/text)', deCe: f.deCe })
      continue
    }
    // stricat — cauza e MĂSURATĂ; acțiunea o URMEAZĂ, nu o inventează.
    if (/binar|fișier|enoent|instalează|repune/.test(c))
      out.push({ functie: f.functie, actiune: 'repara', urmatoareaMasuratoare: 'instalează/repune dependența lipsă pe host, apoi re-probează', deCe: f.deCe })
    else if (/nu răspunde|rețea|timeout|serviciu|\bjos\b/.test(c))
      out.push({ functie: f.functie, actiune: 'masoara_intai', urmatoareaMasuratoare: 're-probează după ce serviciul revine — poate fi tranzitoriu; NU cod de reparat până nu se confirmă', deCe: f.deCe })
    else
      out.push({ functie: f.functie, actiune: 'repara', urmatoareaMasuratoare: 'deschide funcția din cod pe cauza măsurată și repar-o', deCe: f.deCe })
  }
  return out
}

// ── AFIȘAREA PE MONITOR, OBLIGATORIE (owner, 19 aug: „după ce-i ceri, trebuie
// să afișeze OBLIGATORIU rezultatele pe monitor") ────────────────────────────
// Textul MĂSURAT al raportului, pentru suprafața {doc}. Scris server-side de
// executor (nu la alegerea modelului) → afișarea e garantată. Întâi ce NU merge.
export function formatMonitorAutoverificare(raport: RaportAutoverificare, plan: DecizieMasurata[]): { title: string; text: string } {
  const icon = (v: VerdictFunctie): string => (v === 'merge' ? '✅' : v === 'stricat' ? '❌' : '…')
  const planDupaNume = new Map(plan.map((p) => [p.functie, p]))
  const rangV = (v: VerdictFunctie): number => (v === 'stricat' ? 0 : v === 'nu_pot_verifica' ? 1 : 2)
  const problematice = raport.functii.filter((f) => f.verdict !== 'merge').sort((a, b) => rangV(a.verdict) - rangV(b.verdict))
  const linii: string[] = []
  linii.push(`✅ ${raport.merg} merg   ❌ ${raport.stricate} stricate   … ${raport.nepotverifica} nu pot verifica   (din ${raport.total})`)
  if (!problematice.length) {
    linii.push('', `Toate cele ${raport.total} funcții verificate MERG — citirile executate REAL. (Efectele nu se rulează la test — apar la „nu pot verifica".)`)
  } else {
    // NU „CE NU MERGE" pentru tot (audit fake, 20 aug): efectele cablate-dar-nerulate
    // sunt „nu pot verifica", NU stricate. Titlul le numește pe amândouă cinstit.
    linii.push('', 'CE NU MERGE sau NU POT VERIFICA (măsurat):')
    for (const f of problematice) {
      const p = planDupaNume.get(f.functie)
      linii.push('', `${icon(f.verdict)} ${f.functie} — ${f.deCe}`)
      if (p) linii.push(`   → ${p.actiune.toUpperCase().replace('_', ' ')}: ${p.urmatoareaMasuratoare}`)
    }
  }
  return { title: `Autoverificare — ${raport.total} funcții`, text: linii.join('\n') }
}

// ── PROBAREA REALĂ A UNELTELOR GOOGLE/„APLICAȚII" (owner, 19 aug: „verifică
// aplicațiile dacă sunt real funcționale" → „da") ───────────────────────────
// Rezultatul brut al unei unelte Google (runGoogleTool) → probă. Dacă e un semnal
// de EROARE (google_not_connected / argument lipsă), îl tratăm ca EROARE ca să-l
// clasifice corect interpreteazaProba (nu ca „rezultat"). Altfel e date reale
// (Gmail chiar a întors emailuri) → MERGE. PUR și probat.
export function probaDinRezultatGoogle(brut: string): RezultatProba {
  const s = String(brut ?? '')
  try {
    const j = JSON.parse(s) as Record<string, unknown>
    if (j && typeof j === 'object' && !Array.isArray(j) && j.error != null) {
      const er = String(j.error)
      const eroare = /not.?connect|neconectat|invalid_grant|unauthenticated|no.?credential|reconnect|token/i.test(er)
        ? 'Google neconectat / token expirat — reconectează contul'
        : er
      return { ok: false, eroare }
    }
  } catch {
    /* nu-i JSON → e rezultat text real */
  }
  return { ok: true, rezultat: s }
}

// ── RULAREA LIVE, REALĂ (owner, 19 aug: „eu vreau real") ─────────────────────
// Rulează autoverificarea PE SERVER cu execuție REALĂ: citirile prin `uneltele`
// (execuție adevărată), efectele NU se execută (dry-run), iar pe cele picate
// creierul (AI) îmbogățește „de ce". Salvează ultimul raport în kv. Folosită de
// AMBELE uși — ruta admin ȘI unealta de chat `autoverificare` — o SINGURĂ dată
// aici (fără duplicare). Importurile sunt dinamice ca să nu închidă ciclul
// autonomie→adminTools→autoverificare.
export async function autoverificareLive(): Promise<RaportAutoverificare> {
  const { uneltele } = await import('./autonomie.js')
  const { rationeazaMesajeSigur } = await import('./creierRationament.js')
  const { saveKv } = await import('../db.js')
  // UNELTELE „APLICAȚII" (Google/web) merg pe calea CHAT (runGoogleTool), nu prin
  // `uneltele` — de aceea ieșeau fals „necunoscute". Acum le probăm REAL, cu tokenul
  // Google al ownerului (Gmail/Calendar/Drive chiar întorc date; web/wiki n-au nevoie
  // de token). Doar CITIRILE se execută (efectele rămân dry-run).
  const { runGoogleTool, googleTools } = await import('./google.js')
  const { tokenGoogleOwner } = await import('./agentiKelion.js')
  const googleToken = await tokenGoogleOwner().catch(() => '')
  const numeGoogle = new Set(googleTools.map((t) => t.name))
  const raport = await ruleazaAutoverificare({
    // CITIRE: execută unealta real, cu argumente goale (sigur — doar citește).
    probaCitire: async (c) => {
      try {
        // Unealtă Google/„aplicație" → calea ei REALĂ, cu tokenul ownerului.
        if (numeGoogle.has(c.name)) {
          const out = await runGoogleTool(c.name, {}, googleToken)
          return probaDinRezultatGoogle(String(out ?? ''))
        }
        const out = await uneltele(c.name, {})
        return { ok: true, rezultat: String(out ?? '') }
      } catch (e) {
        return { ok: false, eroare: String((e as Error)?.message ?? e).slice(0, 200) }
      }
    },
    // EFECT: NU se execută la test (ar produce efect/cost). Cablajul e garantat de
    // paritatea registru↔unelte (lacătul brainCapabilities); marcăm „cablată".
    esteCablat: () => true,
    // DIAGNOSTIC AI pe cele picate: cauză + recomandare fermă, JSON. Null/eroare →
    // rămâne diagnosticul determinist (regula #1: nu inventăm).
    creierDiag: async (picate) => {
      const lista = picate.map((p) => `- ${p.functie}: face „${p.face}"; simptom măsurat: ${p.deCe}`).join('\n')
      const prompt =
        `Ești diagnosticianul lui Kelion. Pentru FIECARE funcție picată de mai jos, spune DE CE nu merge ` +
        `(cauza cea mai probabilă, scurt) și o RECOMANDARE fermă (ce să facă concret). ` +
        `Răspunde DOAR cu JSON valid: [{"functie":"<nume>","deCe":"<scurt>","recomandare":"<ferm>"}].\n\nFuncții:\n${lista}`
      const txt = await rationeazaMesajeSigur([{ role: 'user', content: prompt }], { ruta: 'autoverificare', treapta: 'lucru', maxTokens: 1200 })
      const m: Record<string, { deCe?: string; recomandare?: string }> = {}
      if (!txt) return m
      try {
        const j = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) as { functie?: string; deCe?: string; recomandare?: string }[]
        for (const x of j) if (x?.functie) m[x.functie] = { deCe: x.deCe, recomandare: x.recomandare }
      } catch {
        /* JSON invalid → rămâne diagnosticul determinist */
      }
      return m
    },
  })
  // hardcod-permis: cheia kv e un identificator intern, nu o valoare arătată omului.
  await saveKv('autoverificare:ultima', JSON.stringify({ la: Date.now(), raport }).slice(0, 100_000)).catch(() => {})
  return raport
}
