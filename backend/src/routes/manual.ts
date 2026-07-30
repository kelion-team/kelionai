import type { FastifyInstance } from 'fastify'
import { buildManual, manualHtml, isManualLang, MANUAL_LANGS, type ManualDoc } from '../services/manual.js'
import { translateStrings, translationReady, normalizeLang } from '../services/manualLang.js'

// ── MANUALUL, PUBLIC ────────────────────────────────────────────────────────
// GET /api/manual?lang=xx  → manualul ca date (pagina din aplicație)
// GET /manual.html?lang=xx → aceeași carte ca pagină de sine stătătoare, de
//                            tipărit sau salvat (butonul de descărcare)
// Public intenționat: e materialul de prezentare al aplicației, îl citește și
// cine nu are cont. Nu conține nimic de admin.

/** Aplatizează manualul în perechi cheie→text, ca să poată fi trimis la tradus
 *  dintr-o singură bucată, apoi reasamblat identic. */
function aplatizeaza(d: ManualDoc): Record<string, string> {
  const out: Record<string, string> = {
    title: d.title,
    subtitle: d.subtitle,
    abilitiesTitle: d.abilitiesTitle,
    abilitiesIntro: d.abilitiesIntro,
    columnWhat: d.columnWhat,
    columnSay: d.columnSay,
  }
  out['flow.t'] = d.flow.title
  d.flow.steps.forEach((p, i) => {
    out[`flow.l${i}`] = p.label
    out[`flow.n${i}`] = p.note
  })
  d.sections.forEach((s, i) => {
    out[`s${i}.t`] = s.title
    s.paragraphs.forEach((p, j) => (out[`s${i}.p${j}`] = p))
  })
  d.groups.forEach((g, i) => {
    out[`g${i}.t`] = g.title
    g.items.forEach((it, j) => {
      out[`g${i}.w${j}`] = it.what
      out[`g${i}.s${j}`] = it.say
    })
  })
  return out
}

/** Pune traducerile înapoi în structură. Ce lipsește rămâne în engleză — o
 *  rubrică goală ar fi mai rea decât un rând netradus. */
function reasambleaza(d: ManualDoc, tr: Record<string, string>, lang: string): ManualDoc {
  const g = (k: string, implicit: string): string => tr[k] ?? implicit
  return {
    lang,
    title: g('title', d.title),
    subtitle: g('subtitle', d.subtitle),
    abilitiesTitle: g('abilitiesTitle', d.abilitiesTitle),
    abilitiesIntro: g('abilitiesIntro', d.abilitiesIntro),
    columnWhat: g('columnWhat', d.columnWhat),
    columnSay: g('columnSay', d.columnSay),
    footer: d.footer,
    // Pictogramele NU trec prin traducere: un emoji tradus ar deveni un cuvânt.
    flow: {
      title: g('flow.t', d.flow.title),
      steps: d.flow.steps.map((p, i) => ({
        icon: p.icon,
        label: g(`flow.l${i}`, p.label),
        note: g(`flow.n${i}`, p.note),
      })),
    },
    sections: d.sections.map((s, i) => ({
      title: g(`s${i}.t`, s.title),
      paragraphs: s.paragraphs.map((p, j) => g(`s${i}.p${j}`, p)),
    })),
    groups: d.groups.map((gr, i) => ({
      title: g(`g${i}.t`, gr.title),
      key: gr.key,
      items: gr.items.map((it, j) => ({
        what: g(`g${i}.w${j}`, it.what),
        say: g(`g${i}.s${j}`, it.say),
      })),
    })),
  }
}

/** Manualul în limba cerută, AȘTEPTÂND traducerea (pentru descărcare: fișierul
 *  trebuie să fie complet în limba aleasă, nu pe jumătate). */
async function manualIn(lang: string): Promise<ManualDoc> {
  const en = buildManual()
  const cod = normalizeLang(lang)
  // Doar cele 7 limbi ale manualului. O limbă în afara listei nu cheamă
  // traducătorul deloc — altfel un singur vizitator care umblă prin selector ar
  // porni zeci de traduceri plătite ale întregului manual.
  if (!cod || cod === 'en' || !isManualLang(cod)) return en
  const tr = await translateStrings(cod, aplatizeaza(en)).catch(() => ({}))
  return Object.keys(tr).length ? reasambleaza(en, tr, cod) : en
}

/** Pentru ECRAN: răspunde INSTANT. Dacă limba e deja tradusă, o dă; dacă nu, dă
 *  engleza cu `ready: false` și pornește traducerea în fundal. Pagina reîntreabă
 *  peste câteva secunde și primește limba cerută.
 *
 *  Fără asta, userul alegea limba și cererea rămânea agățată zeci de secunde —
 *  pe ecran nu se schimba nimic, deci părea că selectorul nu face nimic.
 *  (Măsurat pe live: franceza, în serie, peste 100 de secunde.) */
async function manualRapid(lang: string): Promise<ManualDoc & { ready: boolean }> {
  const en = buildManual()
  const cod = normalizeLang(lang)
  if (!cod || cod === 'en' || !isManualLang(cod)) return { ...en, ready: true }
  const plat = aplatizeaza(en)
  const gata = await translationReady(cod, plat).catch(() => null)
  if (gata && Object.keys(gata).length) return { ...reasambleaza(en, gata, cod), ready: true }
  // Pornește traducerea și NU o aștepta. `translateStrings` are grijă ca mai
  // multe cereri pe aceeași limbă să aștepte aceeași lucrare, nu să pornească
  // fiecare încă una.
  void translateStrings(cod, plat).catch(() => ({}))
  return { ...en, lang: cod, ready: false }
}

/** ── TRADUCE TOT, O DATĂ, LA PORNIRE ────────────────────────────────────────
 *
 *  Măsurat pe live: o limbă netradusă ia ~2 minute (verificat pe germană — la
 *  20/40/60/80/100 secunde încă nu era gata, la 120 a apărut
 *  „Benutzerhandbuch"). Vizitatorul vede „Translating…" și trage concluzia
 *  corectă: că nu merge.
 *
 *  Deci nu-l mai punem pe el să aștepte. La pornirea serverului traducem toate
 *  limbile, una după alta (în serie, ca să nu lovim furnizorul cu 7 deodată), și
 *  le punem în bază. După prima pornire, orice limbă apare INSTANT.
 *
 *  Costă o singură dată per versiune de text: cheia include amprenta textelor
 *  engleze, deci se re-traduce automat doar când chiar se schimbă manualul. */
async function incalzesteTraducerile(): Promise<void> {
  const plat = aplatizeaza(buildManual())
  for (const lang of MANUAL_LANGS) {
    if (lang === 'en') continue
    const gata = await translationReady(lang, plat).catch(() => null)
    if (gata && Object.keys(gata).length) continue
    await translateStrings(lang, plat).catch(() => ({}))
  }
}

export async function manualRoutes(app: FastifyInstance): Promise<void> {
  // Pornește încălzirea fără să blocheze pornirea serverului.
  void incalzesteTraducerile().catch(() => {})
  app.get<{ Querystring: { lang?: string } }>('/api/manual', async (req, reply) => {
    return reply.send(await manualRapid(String(req.query.lang ?? 'en')))
  })

  app.get<{ Querystring: { lang?: string } }>('/manual.html', async (req, reply) => {
    const d = await manualIn(String(req.query.lang ?? 'en'))
    return reply.type('text/html; charset=utf-8').send(manualHtml(d))
  })
}
