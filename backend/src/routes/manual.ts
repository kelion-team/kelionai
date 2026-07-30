import type { FastifyInstance } from 'fastify'
import { buildManual, manualHtml, type ManualDoc } from '../services/manual.js'
import { translateStrings, normalizeLang } from '../services/manualLang.js'

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
    sections: d.sections.map((s, i) => ({
      title: g(`s${i}.t`, s.title),
      paragraphs: s.paragraphs.map((p, j) => g(`s${i}.p${j}`, p)),
    })),
    groups: d.groups.map((gr, i) => ({
      title: g(`g${i}.t`, gr.title),
      items: gr.items.map((it, j) => ({
        what: g(`g${i}.w${j}`, it.what),
        say: g(`g${i}.s${j}`, it.say),
      })),
    })),
  }
}

async function manualIn(lang: string): Promise<ManualDoc> {
  const en = buildManual()
  const cod = normalizeLang(lang)
  if (!cod || cod === 'en') return en
  const tr = await translateStrings(cod, aplatizeaza(en)).catch(() => ({}))
  return Object.keys(tr).length ? reasambleaza(en, tr, cod) : en
}

export async function manualRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { lang?: string } }>('/api/manual', async (req, reply) => {
    return reply.send(await manualIn(String(req.query.lang ?? 'en')))
  })

  app.get<{ Querystring: { lang?: string } }>('/manual.html', async (req, reply) => {
    const d = await manualIn(String(req.query.lang ?? 'en'))
    return reply.type('text/html; charset=utf-8').send(manualHtml(d))
  })
}
