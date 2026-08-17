import type { FastifyInstance } from 'fastify'
import { buildManual, manualHtml, isManualLang, MANUAL_LANGS, type ManualDoc } from '../services/manual.js'
import { translateStrings, translationReady, normalizeLang } from '../services/manualLang.js'

// ── THE MANUAL, PUBLIC ─────────────────────────────────────────────────────
// GET /api/manual?lang=xx  → the manual as data (the in-app page)
// GET /manual.html?lang=xx → the same book as a standalone page, to print or
//                            save (the download button)
// Public on purpose: it's the app's presentation material, readable even
// without an account. It contains nothing admin.

/** Flattens the manual into key→text pairs, so it can be sent to translation
 *  in one piece, then reassembled identically. */
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

/** Puts the translations back into the structure. What is missing stays in
 *  English — an empty section would be worse than an untranslated line. */
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
    // The icons do NOT go through translation: a translated emoji would become a word.
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

/** The manual in the requested language, WAITING for the translation (for
 *  download: the file must be complete in the chosen language, not half). */
async function manualIn(lang: string): Promise<ManualDoc> {
  const en = buildManual()
  const cod = normalizeLang(lang)
  // Only the manual's 7 languages. A language outside the list doesn't call
  // the translator at all — otherwise a single visitor playing with the
  // selector would start dozens of paid translations of the whole manual.
  if (!cod || cod === 'en' || !isManualLang(cod)) return en
  const tr = await translateStrings(cod, aplatizeaza(en)).catch(() => ({}))
  return Object.keys(tr).length ? reasambleaza(en, tr, cod) : en
}

/** For the SCREEN: answers INSTANTLY. If the language is already translated,
 *  it serves it; if not, it serves English with `ready: false` and starts the
 *  translation in the background. The page re-asks a few seconds later and
 *  gets the requested language.
 *
 *  Without this, the user picked the language and the request hung for tens of
 *  seconds — nothing changed on screen, so the selector seemed to do nothing.
 *  (Measured live: French, in series, over 100 seconds.) */
async function manualRapid(lang: string): Promise<ManualDoc & { ready: boolean }> {
  const en = buildManual()
  const cod = normalizeLang(lang)
  if (!cod || cod === 'en' || !isManualLang(cod)) return { ...en, ready: true }
  const plat = aplatizeaza(en)
  const gata = await translationReady(cod, plat).catch(() => null)
  if (gata && Object.keys(gata).length) return { ...reasambleaza(en, gata, cod), ready: true }
  // Starts the translation and does NOT wait for it. `translateStrings`
  // makes sure several requests for the same language await the same job
  // instead of each starting another one.
  void translateStrings(cod, plat).catch(() => ({}))
  return { ...en, lang: cod, ready: false }
}

/** ── TRANSLATE EVERYTHING, ONCE, AT STARTUP ───────────────────────────────
 *
 *  Measured live: an untranslated language takes ~2 minutes (verified on
 *  German — at 20/40/60/80/100 seconds it still wasn't ready, at 120
 *  "Benutzerhandbuch" appeared). The visitor sees "Translating…" and draws
 *  the correct conclusion: that it doesn't work.
 *
 *  So we no longer make him wait. At server startup we translate all the
 *  languages, one after another (in series, so we don't hit the provider with
 *  7 at once), and put them in the database. After the first startup, any
 *  language appears INSTANTLY.
 *
 *  It costs once per text version: the key includes the fingerprint of the
 *  English texts, so it re-translates automatically only when the manual
 *  actually changes. */
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
  // Starts the warm-up without blocking the server's startup.
  void incalzesteTraducerile().catch(() => {})
  app.get<{ Querystring: { lang?: string } }>('/api/manual', async (req, reply) => {
    return reply.send(await manualRapid(String(req.query.lang ?? 'en')))
  })

  app.get<{ Querystring: { lang?: string } }>('/manual.html', async (req, reply) => {
    const d = await manualIn(String(req.query.lang ?? 'en'))
    return reply.type('text/html; charset=utf-8').send(manualHtml(d))
  })
}
